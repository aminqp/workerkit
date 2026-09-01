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
} from './types';
import { MemoryStore } from '../memory-store';
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
 * @typeParam TConfigs - A tuple of WorkerConfig configurations.
 */
class MainWorkerFactory<
  TConfigs extends readonly WorkerConfig<WorkerFunction<unknown, unknown>>[],
> {
  private readonly _workers: WorkerConfig[];
  private readonly _threads: number;
  private readonly _activeWorkers: Set<Worker> = new Set();
  private readonly _memoryStore: MemoryStore = new MemoryStore();
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

    const commonContext = {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
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
   * Spawns necessary threads, manages sharding, and returns a promise
   * that resolves to the settled results of all worker threads.
   *
   * @param workerName - The name of the registered worker to execute.
   * @param rawParams - The payload and options for the worker.
   * @returns A promise resolving to an array of PromiseSettledResults.
   */
  async runWorker<TName extends keyof WorkerConfigMap<TConfigs> & string>(
    workerName: TName,
    rawParams: {
      srcData?: WorkerDataParam<WorkerConfigMap<TConfigs>[TName]>;
      __memory_ref__?: string;
      deleteMemory?: boolean;
    } & Record<string, unknown>,
  ): Promise<
    TypedSettledResults<WorkerReturnType<WorkerConfigMap<TConfigs>[TName]>>
  > {
    return executeWorker(workerName, rawParams, {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      memoryStore: this._memoryStore,
      threads: this._threads,
      orchestrator: this._orchestrator,
      logger: this.logger,
    });
  }

  /**
   * Deletes a specific reference from the isolated memory store.
   *
   * @param ref - The memory reference ID to delete.
   * @returns True if the reference existed and was deleted, false otherwise.
   */
  async deleteMemory(ref: string): Promise<boolean> {
    return this._memoryStore.delete(ref);
  }

  /**
   * Clears all references from the isolated memory store.
   */
  async clearMemory(): Promise<void> {
    this._memoryStore.clear();
  }

  /**
   * Retrieves statistics about the currently stored memory handles.
   *
   * @returns The MemoryStats containing count and active reference IDs.
   */
  async getMemoryStats(): Promise<MemoryStats> {
    return this._memoryStore.stats();
  }

  /**
   * Collects and reduces the results from a `runWorker` execution.
   * Typically spawns a background worker to run the reducer to avoid blocking
   * the main thread.
   *
   * @param settled - The settled results from `runWorker`.
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
   * Terminates all active worker threads, persistent workers, and clears the memory store.
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
