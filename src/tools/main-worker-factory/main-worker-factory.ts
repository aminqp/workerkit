import {
  CollectOptions,
  CollectedResult,
  PipelineStep,
  WorkerConfig,
  WorkerConfigMap,
  WorkerDataParam,
  WorkerFunction,
  WorkerInstanceConfig,
  WorkerResult,
  WorkerReturnType,
  TypedSettledResults,
} from './types.ts';
import { WorkerFactory } from '../worker-factory';
import { WorkerMode } from '../worker-factory/worker-factory';

/**
 * Recursively collects all Transferable objects from a value.
 * Transferables (ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas)
 * are zero-copy — they are moved to the worker instead of cloned.
 */
export function extractTransferables(
  value: unknown,
  seen = new Set<object>(),
): Transferable[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);

  if (
    value instanceof ArrayBuffer ||
    value instanceof MessagePort ||
    (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
  ) {
    return [value as Transferable];
  }

  if (ArrayBuffer.isView(value)) {
    return [value.buffer];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTransferables(item, seen));
  }

  return Object.values(value as object).flatMap((v) =>
    extractTransferables(v, seen),
  );
}

/**
 * Central orchestrator for running typed Web Workers in parallel.
 *
 * `MainWorkerFactory` manages a registry of named worker configurations and
 * handles the full lifecycle of each worker: spawning, partitioning input
 * data across threads, retrying on failure, and collecting results.
 *
 * Also supports:
 * - **Pipelines** — chain workers via `MessageChannel` so intermediate data
 *   never crosses back to the main thread ({@link pipeline}).
 * - **Persistent workers** — keep a worker alive with a cached dataset,
 *   re-running it with different configs without re-sending the data
 *   ({@link runPersistent}, {@link release}).
 *
 * @typeParam TConfigs - A readonly tuple of {@link WorkerConfig} objects that
 *   defines the set of available workers and their typed signatures.
 *
 * @example
 * const foreman = new MainWorkerFactory({
 *   workers: [
 *     { name: 'sum', role: 'compute', func: sumWorker, partition: true },
 *   ] as const,
 * });
 *
 * const settled = await foreman.runWorker('sum', { srcData: [1, 2, 3, 4] });
 * const { data } = await foreman.collectResults(settled);
 */
class MainWorkerFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TConfigs extends readonly WorkerConfig<WorkerFunction<any, any>>[],
> {
  private readonly _workers: WorkerConfig[];
  private readonly _threads: number;
  private readonly _persistentWorkers: Map<string, Worker> = new Map();

  /**
   * Creates a new `MainWorkerFactory`.
   *
   * @param options - Configuration object containing the `workers` registry.
   */
  constructor(options: { workers: TConfigs }) {
    this._workers = options.workers as unknown as WorkerConfig[];
    this._threads = navigator.hardwareConcurrency;
  }

  /**
   * Instantiates a {@link WorkerFactory} for the given worker function.
   *
   * @param workerFunction - The function to run inside the worker thread.
   * @returns A new `WorkerFactory` wrapping the worker.
   */
  private initWorker(workerFunction: WorkerFunction): WorkerFactory {
    return new WorkerFactory(workerFunction);
  }

  /**
   * Splits an array into up to `numChunks` evenly-sized sub-arrays.
   *
   * When the array length is not evenly divisible, the first `remainder`
   * chunks receive one extra element so no data is lost.
   *
   * @param array     - The source array to partition.
   * @param numChunks - Maximum number of chunks to produce.
   *   Clamped to `array.length` so you never get empty chunks.
   * @returns An array of sub-arrays. Returns `[]` when `array` is empty.
   * @throws {Error} When `numChunks` is not a positive integer.
   *
   * @example
   * partitionArray([1, 2, 3, 4, 5], 3);
   * // → [[1, 2], [3, 4], [5]]
   */
  partitionArray<T>(array: T[], numChunks: number): T[][] {
    if (!array.length) return [];
    if (numChunks <= 0) throw new Error('numChunks must be positive');

    const chunks = Math.min(numChunks, array.length);
    const chunkSize = Math.floor(array.length / chunks);
    const remainder = array.length % chunks;
    const result: T[][] = [];
    let start = 0;

    for (let i = 0; i < chunks; i++) {
      const size = chunkSize + (i < remainder ? 1 : 0);
      result.push(array.slice(start, start + size));
      start += size;
    }

    return result;
  }

  /**
   * Looks up a registered worker configuration by name.
   *
   * @param name - The `name` field of the target {@link WorkerConfig}.
   * @returns The matching config, or `undefined` if not found.
   */
  private findWorkerByName(name: string): WorkerConfig | undefined {
    return this._workers.find((w) => w.name === name);
  }

  /**
   * Runs a named worker against the provided data, distributing work across
   * threads when the worker is configured for partitioning.
   *
   * When `config.partition` is `true` and `srcData` is an array with more
   * than one element, the array is split into up to `maxConcurrency` (or
   * `navigator.hardwareConcurrency`) shards and each shard is processed by
   * a separate worker thread in parallel.
   *
   * All threads are awaited with `Promise.allSettled`, so a failure in one
   * shard does not cancel the others. Use {@link collectResults} to merge
   * the settled output.
   *
   * @typeParam TName - The literal name of the worker to run (inferred from
   *   the registered `workers` tuple).
   *
   * @param workerName - Name of the worker as declared in the `workers` config.
   * @param params     - Object containing `srcData` (the payload) plus any
   *   additional key/value pairs forwarded to the worker verbatim.
   *
   * @returns A {@link TypedSettledResults} wrapping the settled promises from
   *   all spawned worker threads.
   *
   * @example
   * const settled = await foreman.runWorker('sum', { srcData: [1, 2, 3] });
   */
  async runWorker<TName extends keyof WorkerConfigMap<TConfigs> & string>(
    workerName: TName,
    {
      srcData,
      ...otherParams
    }: { srcData: WorkerDataParam<WorkerConfigMap<TConfigs>[TName]> } & Record<
      string,
      unknown
    >,
  ): Promise<
    TypedSettledResults<WorkerReturnType<WorkerConfigMap<TConfigs>[TName]>>
  > {
    const config = this.findWorkerByName(workerName);
    if (!config)
      return Promise.reject(new Error(`Worker "${workerName}" not found`));

    const threadCount = config.maxConcurrency ?? this._threads;
    const shouldPartition = Boolean(
      Array.isArray(srcData) && srcData.length > 1 && config.partition,
    );

    const processedData = shouldPartition
      ? this.partitionArray(srcData as unknown[], threadCount)
      : srcData;

    const promises = this.createWorkerPromises(
      config,
      workerName,
      { data: processedData, ...otherParams },
      threadCount,
      shouldPartition,
    );

    const settled = await Promise.allSettled(promises);
    return new TypedSettledResults(settled);
  }

  /**
   * Builds the array of per-thread worker promises for a single `runWorker`
   * call.
   *
   * When `isPartitioned` is `true`, each promise receives its own slice of
   * `srcData`; otherwise every thread receives the full payload.
   *
   * @param config         - The resolved {@link WorkerConfig} for this run.
   * @param workerName     - Name used in error/retry logging.
   * @param srcWorkerData  - Combined `{ data, ...otherParams }` payload.
   * @param threadCount    - Number of parallel worker threads to spawn.
   * @param isPartitioned  - Whether `data` is a pre-split array of shards.
   * @returns An array of promises, one per thread.
   */
  private createWorkerPromises(
    config: WorkerConfig,
    workerName: string,
    srcWorkerData: { data: unknown } & Record<string, unknown>,
    threadCount: number,
    isPartitioned: boolean,
  ): Promise<WorkerResult>[] {
    const { data: srcData, ...otherParams } = srcWorkerData;

    return Array.from({ length: threadCount }, (_, index) => {
      const data =
        isPartitioned && Array.isArray(srcData) ? srcData[index] : srcData;
      return this.runWorkerWithRetry(
        {
          workerFunc: config.func,
          workerName,
          index,
          data: { data, ...otherParams },
        },
        config.retries,
      );
    });
  }

  /**
   * Runs a single worker instance, retrying on failure up to `retryCount`
   * times before re-throwing the last error.
   *
   * Each retry is logged to `console.error` with the remaining attempt count
   * so failures are visible during development.
   *
   * @param instanceConfig - Full configuration for the worker instance.
   * @param retryCount     - Remaining retry attempts (default `2`).
   * @returns The successful {@link WorkerResult} once the worker resolves.
   * @throws The last caught error when all retries are exhausted.
   */
  private async runWorkerWithRetry(
    instanceConfig: WorkerInstanceConfig,
    retryCount = 2,
  ): Promise<WorkerResult> {
    try {
      return await this.initiateWorker(instanceConfig);
    } catch (error) {
      if (retryCount > 0) {
        console.error(
          `Worker ${instanceConfig.index} failed, retrying (${retryCount} left):`,
          error,
        );
        return this.runWorkerWithRetry(instanceConfig, retryCount - 1);
      }
      console.error(`Worker failed after all retries:`, error);
      throw error;
    }
  }

  /**
   * Spawns a single worker thread, posts the payload, and resolves or rejects
   * based on the message the worker sends back.
   *
   * The worker is expected to respond with either:
   * - `{ ok: true, data: T }` — success; resolves with a {@link WorkerResult}.
   * - `{ ok: false, error: string }` — logical failure; rejects with a
   *   structured error object.
   *
   * Any transferable objects found in the payload are moved (not copied) to
   * the worker via the `transfer` list of `postMessage`.
   *
   * The underlying `Worker` is always terminated after the first message,
   * whether it succeeded or failed.
   *
   * @param instanceConfig - Worker function, name, shard index, and data.
   * @returns A promise that resolves with the worker's result.
   */
  private initiateWorker({
    workerFunc,
    workerName,
    index,
    data,
  }: WorkerInstanceConfig): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const worker = this.initWorker(workerFunc);
      const raw = worker.getWorker;

      raw.onerror = (event) => {
        raw.terminate();
        reject({
          index,
          workerConfigs: { workerFunc, workerName, index, data },
          failedResult: event,
        });
      };

      raw.onmessage = (event) => {
        if (event.data?.ok === false) {
          raw.terminate();
          reject({
            index,
            workerConfigs: { workerFunc, workerName, index, data },
            failedResult: new ErrorEvent('error', {
              message: event.data.error,
            }),
          });
          return;
        }
        resolve({
          index,
          workerConfigs: { workerFunc, workerName, index, data },
          successResult: new MessageEvent('message', {
            data: event.data?.data,
          }),
        });
        raw.terminate();
      };

      const payload = {
        index,
        ...(Array.isArray(data) ? { data } : (data as Record<string, unknown>)),
      };
      raw.postMessage(payload, extractTransferables(payload));
    });
  }

  /**
   * Collects and merges the settled results from {@link runWorker} — off the
   * main thread.
   *
   * Fulfilled shards are extracted and passed to the `reducer` function, which
   * runs inside a dedicated inline worker so the merge itself never blocks the
   * main thread. Failed shards are counted and their raw rejection reasons are
   * preserved in `errors`.
   *
   * @typeParam T - The per-shard data type (inferred from `settled`).
   * @typeParam R - The final merged output type (defaults to a flat array of
   *   `T` items when no custom reducer is provided).
   *
   * @param settled  - The {@link TypedSettledResults} returned by `runWorker`.
   * @param options  - Optional {@link CollectOptions}. Supply a `reducer` to
   *   control how shards are merged. The reducer **must be self-contained**
   *   (no closures over external variables) because it is serialised and run
   *   inside a worker.
   *
   * @returns A {@link CollectedResult} with the merged `data`, counts of
   *   `succeeded`/`failed` shards, and the raw `errors` array.
   *
   * @example
   * // default: flat array of all shard data
   * const { data, succeeded, failed } = await foreman.collectResults(res);
   *
   * @example
   * // custom reducer: sum numbers across shards
   * const { data } = await foreman.collectResults<number[], number>(res, {
   *   reducer: (shards) => shards.flat().reduce((a, b) => a + b, 0),
   * });
   */
  async collectResults<
    T = unknown,
    R = T extends (infer Item)[] ? Item[] : T[],
  >(
    settled: TypedSettledResults<T>,
    options: CollectOptions<T, R> = {},
  ): Promise<CollectedResult<R>> {
    const fulfilled = settled.results.filter(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<WorkerResult>[];
    const errors = settled.results.filter(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult[];

    const shards = fulfilled.map((r) => r.value.successResult!.data as T);

    // Build a self-contained merge function for the worker
    const reducerSrc = options.reducer
      ? options.reducer.toString()
      : '(shards) => shards.flat()';

    const mergeResult = await new Promise<R>((resolve, reject) => {
      const workerSrc = `
        const reducer = ${reducerSrc};
        self.addEventListener('message', (event) => {
          try {
            const result = reducer(event.data);
            self.postMessage({ ok: true, data: result });
          } catch (err) {
            self.postMessage({ ok: false, error: String(err) });
          }
        });
      `;
      const blob = new Blob([workerSrc], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      worker.onmessage = (e) => {
        worker.terminate();
        if (e.data.ok) resolve(e.data.data);
        else reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(e);
      };
      worker.postMessage(shards);
    });

    return {
      data: mergeResult,
      succeeded: fulfilled.length,
      failed: errors.length,
      errors,
    };
  }

  /**
   * Runs a chain of workers where each step's output feeds directly into the
   * next step — **without passing through the main thread**.
   *
   * Internally, adjacent workers are connected via `MessageChannel` ports.
   * Only the final result is sent back to the main thread, minimising
   * serialisation overhead for large intermediate data.
   *
   * @typeParam TResult - The expected type of the final pipeline output.
   *   Defaults to `unknown` if not specified.
   *
   * @param steps - An ordered array of {@link PipelineStep} objects. The first
   *   step must include `srcData`; subsequent steps receive the previous
   *   step's output as `{ data: previousOutput, index: 0 }`.
   *
   * @returns A promise that resolves with the final step's output.
   * @throws {Error} When `steps` is empty or a worker name is not found.
   *
   * @example
   * const result = await foreman.pipeline<FilteredPost[]>([
   *   { worker: 'fetchPosts', srcData: { url: '/api/posts' } },
   *   { worker: 'transformPosts' },
   *   { worker: 'filterPosts' },
   * ]);
   * console.log(result); // final transformed + filtered data
   */
  async pipeline<TResult = unknown>(steps: PipelineStep[]): Promise<TResult> {
    if (steps.length === 0) {
      throw new Error('Pipeline requires at least one step');
    }

    if (steps.length === 1) {
      const step = steps[0];
      const config = this.findWorkerByName(step.worker);
      if (!config) throw new Error(`Worker "${step.worker}" not found`);
      const worker = this.initWorker(config.func);
      const raw = worker.getWorker;

      return new Promise<TResult>((resolve, reject) => {
        raw.onmessage = (e) => {
          raw.terminate();
          if (e.data?.ok === false) reject(new Error(e.data.error));
          else resolve(e.data?.data as TResult);
        };
        raw.onerror = (e) => {
          raw.terminate();
          reject(e);
        };
        const payload = step.srcData ?? {};
        raw.postMessage(
          { data: payload, index: 0 },
          extractTransferables(payload),
        );
      });
    }

    // Build the pipeline: connect workers via MessageChannels
    return new Promise<TResult>((resolve, reject) => {
      const workers: Worker[] = [];
      const channels: MessageChannel[] = [];

      // Create all workers
      for (const step of steps) {
        const config = this.findWorkerByName(step.worker);
        if (!config) {
          reject(new Error(`Worker "${step.worker}" not found`));
          return;
        }
        const factory = new WorkerFactory(config.func, {
          mode: WorkerMode.Pipeline,
        });
        workers.push(factory.getWorker);
      }

      // Create channels between adjacent workers
      for (let i = 0; i < workers.length - 1; i++) {
        channels.push(new MessageChannel());
      }

      // Wire up: each worker (except last) gets an output port
      // Each worker (except first) gets an input port
      for (let i = 0; i < workers.length; i++) {
        const transferList: Transferable[] = [];
        const ports: { inputPort?: MessagePort; outputPort?: MessagePort } = {};

        if (i > 0) {
          // Receive input from previous worker's channel
          ports.inputPort = channels[i - 1].port1;
          transferList.push(ports.inputPort);
        }

        if (i < workers.length - 1) {
          // Send output to next worker's channel
          ports.outputPort = channels[i].port2;
          transferList.push(ports.outputPort);
        }

        // Send ports to the worker for pipeline wiring
        workers[i].postMessage(
          { __pipeline_ports__: true, ...ports },
          transferList,
        );
      }

      // Listen for the final worker's result
      const lastWorker = workers[workers.length - 1];
      lastWorker.onmessage = (e) => {
        // Terminate all workers
        workers.forEach((w) => w.terminate());
        if (e.data?.ok === false) reject(new Error(e.data.error));
        else resolve(e.data?.data as TResult);
      };
      lastWorker.onerror = (e) => {
        workers.forEach((w) => w.terminate());
        reject(e);
      };

      // Kick off the first worker with srcData
      const firstPayload = steps[0].srcData ?? {};
      workers[0].postMessage(
        { data: firstPayload, index: 0 },
        extractTransferables(firstPayload),
      );
    });
  }

  /**
   * Runs a persistent worker that caches its dataset between calls.
   *
   * On the first call, provide both `dataset` and `config`. The worker stores
   * the dataset in memory. On subsequent calls, only `config` is needed — the
   * worker reuses the cached dataset and reprocesses it with the new config.
   *
   * The worker stays alive until {@link release} is called.
   *
   * @param workerName - Name of the registered worker.
   * @param params - Object with optional `dataset` and required `config`.
   * @returns The worker function's return value.
   *
   * @example
   * // First call: send dataset + config
   * const r1 = await factory.runPersistent('transform', {
   *   dataset: largeArray,
   *   config: { multiplier: 2 },
   * });
   *
   * // Subsequent calls: only config, dataset is cached
   * const r2 = await factory.runPersistent('transform', {
   *   config: { multiplier: 5 },
   * });
   *
   * // Update dataset when needed
   * const r3 = await factory.runPersistent('transform', {
   *   dataset: newArray,
   *   config: { multiplier: 3 },
   * });
   *
   * // Release when done
   * factory.release('transform');
   */
  async runPersistent<TResult = unknown>(
    workerName: string,
    params: { dataset?: unknown; config: unknown },
  ): Promise<TResult> {
    const config = this.findWorkerByName(workerName);
    if (!config) throw new Error(`Worker "${workerName}" not found`);

    // Get or create the persistent worker
    let raw = this._persistentWorkers.get(workerName);
    if (!raw) {
      const factory = new WorkerFactory(config.func, {
        mode: WorkerMode.Persistent,
      });
      raw = factory.getWorker;
      this._persistentWorkers.set(workerName, raw);
    }

    return new Promise<TResult>((resolve, reject) => {
      raw!.onmessage = (e) => {
        if (e.data?.ok === false) {
          reject(new Error(e.data.error));
        } else {
          resolve(e.data?.data as TResult);
        }
      };
      raw!.onerror = (e) => {
        reject(e);
      };

      const message: { type: string; config: unknown; dataset?: unknown } = {
        type: 'run',
        config: params.config,
      };
      if (params.dataset !== undefined) {
        message.dataset = params.dataset;
      }
      raw!.postMessage(message, extractTransferables(message));
    });
  }

  /**
   * Releases a persistent worker, freeing its cached dataset and terminating
   * the thread.
   *
   * After calling `release`, subsequent `runPersistent` calls for this worker
   * will create a fresh instance (requiring a new dataset).
   *
   * @param workerName - Name of the persistent worker to release.
   */
  release(workerName: string): void {
    const raw = this._persistentWorkers.get(workerName);
    if (raw) {
      raw.postMessage({ type: 'release' });
      raw.terminate();
      this._persistentWorkers.delete(workerName);
    }
  }
}

export default MainWorkerFactory;
