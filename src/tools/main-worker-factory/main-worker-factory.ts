import {
  CollectOptions,
  CollectedResult,
  PipelineStep,
  WorkerConfig,
  WorkerConfigMap,
  WorkerDataParam,
  WorkerFunction,
  WorkerReturnType,
  TypedSettledResults,
  MemoryStats,
  RunWorkerOptions,
} from './types';
import { MemoryStore } from '../memory-store';
import { MemoryWorkerProxy } from '../memory-store';
import { Logger, LogLevel } from '../logger';
import { executeWorker } from '../run-worker';

// Import extracted modules
import { extractTransferable } from '../extract-transferable';
import { partitionArray } from '../partition-array';
import { executePipeline } from '../pipeline';
import { collectWorkerResults } from '../collect-results';
import { PersistentWorkerManager } from '../persistent-manager';
import { WorkerOrchestrator } from '../orchestrator';

export { extractTransferable };

/**
 * Main orchestration class for Web Worker management.
 * Provides high-level APIs to configure, dispatch, and monitor workers,
 * handling memory isolation, sharding, and concurrency.
 *
 * Workers store their results directly into the dedicated `MemoryWorker` thread
 * via a pre-allocated `MessagePort`. Only lightweight `__memory_ref__` tokens
 * cross the main thread boundary. `runWorker` auto-collects shards and returns
 * a `CollectedResult<R>` directly — no manual `collectResults` call needed.
 *
 * @typeParam TConfigs - A tuple of WorkerConfig configurations.
 */
class MainWorkerFactory<
  TConfigs extends readonly WorkerConfig<WorkerFunction<unknown, unknown>>[],
> {
  private readonly _workers: WorkerConfig[];
  private readonly _threads: number;
  private readonly _activeWorkers: Set<Worker> = new Set();
  private readonly _memoryStore: MemoryStore = new MemoryStore();
  private readonly _memoryWorkerProxy: MemoryWorkerProxy;
  private readonly _factoryToken: string;
  private _isTerminated = false;

  private readonly _persistentManager: PersistentWorkerManager;
  private readonly _orchestrator: WorkerOrchestrator;

  /**
   * The logger instance used by this factory.
   */
  public readonly logger: Logger;

  /**
   * Initializes a new MainWorkerFactory.
   *
   * @param options - Configuration options.
   * @param options.workers - The list of worker configurations.
   * @param options.logLevel - Optional logging level (defaults to 'error').
   */
  constructor(options: { workers: TConfigs; logLevel?: LogLevel }) {
    this._workers = options.workers as unknown as WorkerConfig[];
    this.logger = new Logger(options.logLevel ?? 'error');
    this._threads =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;

    // Generate a secret token for MemoryWorker authentication.
    // All workers spawned by this factory instance use this token.
    this._factoryToken = crypto.randomUUID();
    this._memoryWorkerProxy = new MemoryWorkerProxy(this._factoryToken);

    const commonContext = {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
      memoryWorkerProxy: this._memoryWorkerProxy,
      factoryToken: this._factoryToken,
    };

    this._persistentManager = new PersistentWorkerManager(commonContext);
    this._orchestrator = new WorkerOrchestrator(commonContext);
  }

  /**
   * Indicates whether the factory has been terminated.
   */
  get isTerminated(): boolean {
    return this._isTerminated;
  }

  private trackWorker(worker: Worker): Worker {
    if (this._isTerminated) {
      worker.terminate();
      throw new Error('MainWorkerFactory has been terminated');
    }
    this._activeWorkers.add(worker);
    return worker;
  }

  private terminateWorker(worker: Worker): void {
    this._activeWorkers.delete(worker);
    try {
      worker.terminate();
    } catch {
      // Ignore errors if worker is already terminated
    }
  }

  /**
   * Helper utility to partition an array into a specified number of chunks.
   *
   * @param array - The array to partition.
   * @param numChunks - The desired number of chunks.
   * @returns An array of array chunks.
   */
  partitionArray<T>(array: T[], numChunks: number): T[][] {
    return partitionArray(array, numChunks);
  }

  private findWorkerByName(name: string): WorkerConfig | undefined {
    return this._workers.find((worker) => worker.name === name);
  }

  /**
   * Dispatches a worker task with the given parameters.
   *
   * Workers store their results directly in the `MemoryWorker` thread — large data
   * never touches the main thread heap. Results are auto-collected and merged in a
   * dedicated reducer worker. Returns a `CollectedResult<R>` directly.
   *
   * Pass `autoCollect: false` in `rawParams` to skip auto-collection and receive
   * the raw settled state (escape hatch for advanced custom reducers).
   *
   * @param workerName - The name of the registered worker to execute.
   * @param rawParams - The payload, options, and reducer for the worker.
   * @returns A promise resolving to a CollectedResult with merged data and shard stats.
   */
  async runWorker<
    TName extends keyof WorkerConfigMap<TConfigs> & string,
    T = WorkerReturnType<WorkerConfigMap<TConfigs>[TName]>,
    R = T extends (infer Item)[] ? Item[] : T[],
  >(
    workerName: TName,
    rawParams: {
      srcData?: WorkerDataParam<WorkerConfigMap<TConfigs>[TName]>;
      __memory_ref__?: string;
      deleteMemory?: boolean;
    } & RunWorkerOptions<T, R> &
      Record<string, unknown>,
  ): Promise<CollectedResult<R>> {
    return executeWorker(workerName, rawParams, {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      memoryStore: this._memoryStore,
      memoryWorkerProxy: this._memoryWorkerProxy,
      factoryToken: this._factoryToken,
      threads: this._threads,
      orchestrator: this._orchestrator,
      logger: this.logger,
    });
  }

  /**
   * Deletes a specific reference from the memory store and MemoryWorker.
   *
   * @param ref - The memory reference ID to delete.
   * @returns True if the reference existed and was deleted, false otherwise.
   */
  async deleteMemory(ref: string): Promise<boolean> {
    this._memoryStore.delete(ref);
    return this._memoryWorkerProxy.delete(ref);
  }

  /**
   * Clears all references from the memory store and MemoryWorker.
   */
  async clearMemory(): Promise<void> {
    this._memoryStore.clear();
    await this._memoryWorkerProxy.clear();
  }

  /**
   * Retrieves statistics about the currently stored memory handles.
   *
   * @returns The MemoryStats containing count and active reference IDs.
   */
  async getMemoryStats(): Promise<MemoryStats> {
    return this._memoryWorkerProxy.stats();
  }

  /**
   * Collects and reduces the results from a `runWorker` execution.
   *
   * @deprecated `runWorker` now auto-collects results. This method is kept as
   * an escape hatch for advanced cases where `autoCollect: false` was passed to
   * `runWorker`. In the common case, the return value of `runWorker` already
   * contains the merged `CollectedResult`.
   *
   * @param settled - The settled results from `runWorker` (when `autoCollect: false`).
   * @param options - Options containing the reducer function.
   * @returns A structured CollectedResult object.
   */
  async collectResults<
    T = unknown,
    R = T extends (infer Item)[] ? Item[] : T[],
  >(
    settled: TypedSettledResults<T> | TypedSettledResults<unknown>,
    options: CollectOptions<T, R> = {},
  ): Promise<CollectedResult<R>> {
    return collectWorkerResults(settled, options, {
      isTerminated: () => this.isTerminated,
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
      memoryWorkerProxy: this._memoryWorkerProxy,
      factoryToken: this._factoryToken,
    });
  }

  /**
   * Executes a sequential pipeline of worker steps.
   * Passes the output (memory reference or raw data) of one step as the input
   * to the next step.
   *
   * @param steps - An array of PipelineStep configurations.
   * @returns The final result of the pipeline execution.
   */
  async pipeline<TResult = unknown>(steps: PipelineStep[]): Promise<TResult> {
    return executePipeline(steps, {
      memoryStore: this._memoryStore,
      memoryWorkerProxy: this._memoryWorkerProxy,
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
    });
  }

  /**
   * Executes a task on a persistent (long-lived) worker thread.
   * Useful for workers that maintain local state (like WebAssembly modules or databases)
   * across multiple invocations.
   *
   * @param workerName - The name of the persistent worker to run.
   * @param params - The input data and configuration for the task.
   * @returns The result from the persistent worker thread.
   */
  async runPersistent<TResult = unknown>(
    workerName: string,
    params: { dataset?: unknown; config: unknown },
  ): Promise<TResult> {
    return this._persistentManager.runPersistent(workerName, params);
  }

  /**
   * Releases and terminates a persistent worker by name.
   *
   * @param workerName - The name of the persistent worker to release.
   */
  release(workerName: string): void {
    this._persistentManager.release(workerName);
  }

  /**
   * Terminates all active worker threads, persistent workers, MemoryWorker, and clears the memory store.
   * Marks this factory instance as terminated.
   */
  terminate(): void {
    this._isTerminated = true;
    this._persistentManager.terminateAll();
    for (const worker of Array.from(this._activeWorkers)) {
      this.terminateWorker(worker);
    }
    this._activeWorkers.clear();
    this._memoryStore.clear();
    this._memoryWorkerProxy.terminate();
  }

  /**
   * Alias for {@link terminate}. Terminates all active resources.
   */
  destroy(): void {
    this.terminate();
  }

  /**
   * Terminates all resources and resets the factory to an active state.
   */
  reset(): void {
    this.terminate();
    this._isTerminated = false;
  }

  /**
   * Alias for {@link reset}. Terminates and reactivates the factory.
   */
  restart(): void {
    this.reset();
  }
}

export default MainWorkerFactory;
