import {
  CollectOptions,
  CollectedResult,
  WorkerConfig,
  WorkerConfigByName,
  WorkerConfigMap,
  WorkerDataParam,
  WorkerReturnType,
  TypedSettledResults,
  MemoryStats,
  RunWorkerOptions,
  RunWorkerResult,
} from './types';
import { MemoryStore } from '../memory-store';
import { MemoryWorkerProxy } from '../memory-store';
import { Logger, LogLevel } from '../logger';
import { executeWorker } from '../run-worker';

// Import extracted modules
import { partitionArray } from '../partition-array';
import { executePipeline } from '../pipeline';
import { collectWorkerResults } from '../collect-results';
import { PersistentWorkerManager } from '../persistent-manager';
import { WorkerOrchestrator } from '../orchestrator';
import { terminatedError } from '../lifecycle';
import { extractTransferable } from '../extract-transferable';

/**
 * The thread a factory leaves running if it is dropped without `terminate()`:
 * its MemoryWorker. Must not reference the factory, or the factory could
 * never be garbage-collected.
 */
interface FactoryThreads {
  memoryWorker: MemoryWorkerProxy;
}

/**
 * Safety net for factories dropped without `terminate()` — for example one
 * created during a React render: once such a factory is garbage-collected,
 * its MemoryWorker is stopped instead of running until the page unloads.
 * Collection may happen late (or not at all), so terminate factories you are
 * done with.
 */
const abandonedFactories =
  typeof FinalizationRegistry === 'undefined'
    ? undefined
    : new FinalizationRegistry<FactoryThreads>((threads) =>
        threads.memoryWorker.terminate(),
      );

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
 * Lifecycle: the MemoryWorker thread starts on the first call, so creating a
 * factory is cheap. `terminate()` stops every worker and rejects every call
 * that is still running with "MainWorkerFactory has been terminated".
 * `reset()` does the same and then starts a fresh run (new MemoryWorker), so
 * the factory can be used again. A factory that is garbage-collected without
 * `terminate()` has its MemoryWorker stopped as a safety net.
 *
 * @typeParam TConfigs - A tuple of WorkerConfig configurations.
 */
class MainWorkerFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TConfigs extends readonly WorkerConfig<any>[],
> {
  private readonly _workers: WorkerConfig[];
  private readonly _threads: number;
  private readonly _activeWorkers: Set<Worker> = new Set();
  private readonly _memoryStore: MemoryStore = new MemoryStore();
  private readonly _factoryToken: string;
  private _isTerminated = false;

  /** MemoryWorker of the current run — replaced by `reset()`. */
  private _memoryWorkerProxy: MemoryWorkerProxy;
  /** What the GC safety net stops if this factory is dropped (see above). */
  private readonly _ownedThreads: FactoryThreads;
  /** Cancels every call of the current run — replaced by `reset()`. */
  private _lifecycle = new AbortController();

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
   * @param options.logLevel - How much the factory logs to the console: `'silent'`,
   *   `'error'` (default — failures only), `'info'` (also attempts that will be
   *   retried) or `'verbose'` (also debug detail). Worker errors are not reported
   *   as uncaught page errors; this logger is where they surface.
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
    this._ownedThreads = { memoryWorker: this._memoryWorkerProxy };
    abandonedFactories?.register(this, this._ownedThreads);

    const currentProxy = () => this._memoryWorkerProxy;
    const currentSignal = () => this._lifecycle.signal;

    // Long-lived collaborators read the proxy and signal through getters so
    // they always see the current run's instances after a reset().
    const commonContext = {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
      get memoryWorkerProxy() {
        return currentProxy();
      },
      get signal() {
        return currentSignal();
      },
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
      throw terminatedError();
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
   * @template T - The type of elements in the array.
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
   * dedicated reducer worker. Returns a `CollectedResult<R>` directly — or, for a
   * worker configured with `memoryOnly: true`, a `MemoryRefResult` holding only the
   * `__memory_ref__`.
   *
   * Pass `autoCollect: false` in `rawParams` to skip auto-collection and receive
   * the raw settled state (escape hatch for advanced custom reducers).
   *
   * A shard that still fails after its retries does not reject the call: it is
   * counted in `failed` and listed in `errors`.
   *
   * @param workerName - The name of the registered worker to execute.
   * @param rawParams - The payload, options, and reducer for the worker. Pass
   *   `__memory_ref__` instead of `srcData` to start from stored data (and
   *   `deleteMemory: true` to free it afterwards): the workers read it — or,
   *   with `partition`, their part of it — straight from the MemoryWorker.
   *   Neither key is passed on to the worker function.
   * @returns A promise resolving to the merged result and shard stats. Rejects with
   *          "MainWorkerFactory has been terminated" if the factory is terminated first.
   * @template TName - The name of the registered worker.
   * @template T - The return type of the worker function.
   * @template R - The merged return type after reducing shards.
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
  ): Promise<RunWorkerResult<WorkerConfigByName<TConfigs, TName>, R>> {
    const result = await executeWorker(workerName, rawParams, {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      memoryStore: this._memoryStore,
      memoryWorkerProxy: this._memoryWorkerProxy,
      factoryToken: this._factoryToken,
      threads: this._threads,
      orchestrator: this._orchestrator,
      logger: this.logger,
      signal: this._lifecycle.signal,
    });
    return result as RunWorkerResult<WorkerConfigByName<TConfigs, TName>, R>;
  }

  /**
   * Stores `data` in the MemoryWorker and returns its ref.
   *
   * Pass data to the workers once, then start any number of calls from the
   * ref (`__memory_ref__`): `runWorker` and `pipeline` workers read it — or,
   * with `partition`, only their part of it — straight from the MemoryWorker,
   * so it does not cross from the main thread again for every worker or call.
   * Free it with `deleteMemory(ref)` (or `deleteMemory: true` on the last call).
   *
   * `ArrayBuffer`s in `data` are moved to the MemoryWorker, not copied: they
   * are detached (empty) in your code afterwards.
   *
   * @param data - The data to store.
   * @returns The ref to pass as `__memory_ref__`.
   */
  async setMemory(data: unknown): Promise<string> {
    if (this._isTerminated) throw terminatedError();
    const ref = await this._memoryWorkerProxy.set(
      data,
      undefined,
      extractTransferable(data),
    );
    this._memoryStore.register(ref);
    return ref;
  }

  /**
   * Reads a stored value back to the main thread.
   *
   * @param ref - The ref returned by `setMemory`, or by a `memory` /
   *   `memoryOnly` worker.
   * @returns The stored value, or `undefined` if there is none.
   */
  async getMemory<T = unknown>(ref: string): Promise<T | undefined> {
    return (await this._memoryWorkerProxy.get(ref)) as T | undefined;
  }

  /**
   * Deletes a specific reference from the memory store and MemoryWorker.
   *
   * @param ref - The memory reference ID to delete.
   * @returns True if the reference existed and was deleted, false otherwise.
   *          Rejects with "MainWorkerFactory has been terminated" after
   *          `terminate()`, until `reset()` is called.
   */
  async deleteMemory(ref: string): Promise<boolean> {
    this._memoryStore.delete(ref);
    return this._memoryWorkerProxy.delete(ref);
  }

  /**
   * Clears all references from the memory store and MemoryWorker.
   * Rejects with "MainWorkerFactory has been terminated" after `terminate()`,
   * until `reset()` is called.
   */
  async clearMemory(): Promise<void> {
    this._memoryStore.clear();
    await this._memoryWorkerProxy.clear();
  }

  /**
   * Retrieves statistics about the currently stored memory handles.
   *
   * @returns The MemoryStats containing count and active reference IDs.
   *          Rejects with "MainWorkerFactory has been terminated" after
   *          `terminate()`, until `reset()` is called.
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
   * @template T - The type of the worker result data.
   * @template R - The type of the merged result data.
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
      signal: this._lifecycle.signal,
    });
  }

  /**
   * Executes a sequential pipeline of worker steps.
   * Passes the output of one step as the input to the next step.
   *
   * If a step fails, the pipeline rejects with an `Error` carrying that step's
   * message and stops all of its workers. Steps are not retried.
   *
   * @param steps - An array of PipelineStep configurations. The first step may
   *   pass `__memory_ref__` instead of `srcData` to start from a stored result.
   * @returns A CollectedResult containing the final pipeline output and shard stats,
   *          consistent with the shape returned by `runWorker()`. Rejects with
   *          "MainWorkerFactory has been terminated" if the factory is terminated first.
   * @template TResult - The type of the pipeline result.
   */
  async pipeline<TResult = unknown>(
    steps: {
      worker: keyof WorkerConfigMap<TConfigs> & string;
      srcData?: unknown;
      [key: string]: unknown;
    }[],
  ): Promise<CollectedResult<TResult>> {
    return executePipeline(steps, {
      memoryStore: this._memoryStore,
      memoryWorkerProxy: this._memoryWorkerProxy,
      factoryToken: this._factoryToken,
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
      signal: this._lifecycle.signal,
    });
  }

  /**
   * Executes a task on a persistent (long-lived) worker thread.
   * Useful for workers that maintain local state (like WebAssembly modules or databases)
   * across multiple invocations.
   *
   * Overlapping calls are safe: each call receives its own result. Pending calls
   * reject if the worker is released, crashes, or the factory is terminated.
   *
   * @param workerName - The name of the persistent worker to run.
   * @param params - The input data and configuration for the task.
   * @returns The result from the persistent worker thread.
   * @template TResult - The expected type of the result from the worker thread.
   */
  async runPersistent<
    TName extends keyof WorkerConfigMap<TConfigs> & string,
    TResult = WorkerReturnType<WorkerConfigMap<TConfigs>[TName]>,
  >(
    workerName: TName,
    params: { dataset?: unknown; config: unknown },
  ): Promise<TResult> {
    return this._persistentManager.runPersistent(workerName, params);
  }

  /**
   * Releases and terminates a persistent worker by name. Calls still waiting
   * on it reject; the next `runPersistent` call starts a fresh worker.
   *
   * @param workerName - The name of the persistent worker to release.
   */
  release(workerName: string): void {
    this._persistentManager.release(workerName);
  }

  /**
   * Terminates all active worker threads, persistent workers, MemoryWorker, and clears the memory store.
   * Every call still running rejects with "MainWorkerFactory has been terminated".
   * Marks this factory instance as terminated.
   */
  terminate(): void {
    this._isTerminated = true;
    this._lifecycle.abort();
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
   * Terminates all resources and resets the factory to an active state with
   * a fresh MemoryWorker. Calls that were running reject; new calls work.
   */
  reset(): void {
    this.terminate();
    this._memoryWorkerProxy = new MemoryWorkerProxy(this._factoryToken);
    this._ownedThreads.memoryWorker = this._memoryWorkerProxy;
    this._lifecycle = new AbortController();
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
