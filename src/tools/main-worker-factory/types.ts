import { WorkerFactory } from '../worker-factory';
import { LogLevel } from '../logger';

/** A unique string identifier for a worker, matching its `name` field. */
export type WorkerName = string;

/** A descriptive label for the worker's role (e.g. `'compute'`, `'io'`). */
export type WorkerRole = string;

/**
 * The shape of a function that runs inside a Web Worker.
 *
 * Workers receive a single `params` argument posted from the main thread and
 * return (or resolve) a result that is posted back.
 *
 * @typeParam TParams - The type of the message payload sent to the worker.
 * @typeParam TResult - The type of the value the worker posts back.
 */
export type WorkerFunction<TParams = unknown, TResult = unknown> = (
  params: TParams,
) => TResult;

/**
 * Configuration object that registers a named worker with the factory.
 *
 * @typeParam TFunc - The concrete {@link WorkerFunction} type for this worker.
 */
export interface WorkerConfig<TFunc extends WorkerFunction = WorkerFunction> {
  /** Unique name used to look up this worker via `runWorker`. */
  name: WorkerName;
  /** Human-readable role label (e.g. `'compute'`, `'transform'`). */
  role: WorkerRole;
  /** The worker function that will be serialised and run in a thread. Optional if `createWorker` is provided. */
  func?: TFunc;
  /**
   * Factory function returning a native `Worker` instance (e.g. `() => new Worker(new URL('./worker.ts', import.meta.url))`).
   * Enables bundlers like Webpack 5, Vite, Rollup, and Parcel to statically analyze and bundle worker code into individual chunks,
   * while allowing `MainWorkerFactory` to scale concurrency and manage worker thread lifecycles.
   */
  createWorker?: () => Worker;
  /**
   * Maximum number of parallel threads to spawn for this worker.
   * Defaults to `navigator.hardwareConcurrency` when omitted.
   */
  maxConcurrency?: number;
  /**
   * Number of times a failed worker thread is retried before the shard is
   * marked as rejected. Defaults to `2`.
   */
  retries?: number;
  /**
   * When `true`, an array `srcData` is split into per-thread shards before
   * being dispatched. Each thread receives one shard instead of the full
   * array.
   */
  partition?: boolean;
  /**
   * A list of worker functions that must complete before this worker can start.
   * If any dependency fails, this worker will not run.
   */
  dependencies?: Array<() => void>;
  /**
   * When `true`, the worker's output is saved in the isolated `MemoryWorker`
   * and returned alongside a `__memory_ref__` token.
   */
  memory?: boolean;
  /**
   * When `true`, the worker's output is saved in the isolated `MemoryWorker`
   * and **only** the `__memory_ref__` token is returned (0 bytes data transferred back to main thread).
   */
  memoryOnly?: boolean;
}

/** Statistics about stored memory handles in MemoryWorker. */
export interface MemoryStats {
  /** Total number of active memory references. */
  count: number;
  /** Array of active reference IDs. */
  refs: string[];
}

/**
 * Derives a `name → function` map from a readonly tuple of
 * {@link WorkerConfig} objects.
 *
 * Used internally to give `runWorker` a fully-typed `workerName` parameter
 * and to infer the correct `srcData` type for each worker.
 *
 * @typeParam T - The readonly tuple of `WorkerConfig` values.
 */
export type WorkerConfigMap<
  T extends readonly WorkerConfig<WorkerFunction<unknown, unknown>>[],
> = {
  [K in T[number]['name']]: NonNullable<
    Extract<T[number], { name: K }>['func']
  > extends WorkerFunction
    ? NonNullable<Extract<T[number], { name: K }>['func']>
    : WorkerFunction;
};

/**
 * Extracts the `params` type from a {@link WorkerFunction}.
 *
 * @typeParam TFunc - The worker function to inspect.
 */
export type WorkerParams<TFunc extends WorkerFunction> =
  TFunc extends WorkerFunction<infer P, unknown> ? P : never;

/**
 * Extracts the `data` field type from a worker function's params.
 * Workers receive `{ data: T, index: number, ...otherParams }` — this
 * pulls out just `T` so callers only need to supply the payload.
 *
 * Always allows `D | D[]` so partitioned workers can receive an array
 * that the framework splits into per-shard items.
 */
export type WorkerDataParam<TFunc extends WorkerFunction> =
  WorkerParams<TFunc> extends { data: infer D }
    ? D extends (infer Item)[]
      ? Item[] // already an array type — keep as-is
      : D | D[] // scalar — also allow array for partitioned usage
    : WorkerParams<TFunc>;

/** Extracts the return type from a {@link WorkerFunction}, unwrapping `Promise<T>` → `T`. */
export type WorkerReturnType<TFunc extends WorkerFunction> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TFunc extends WorkerFunction<any, infer R>
    ? R extends Promise<infer Resolved>
      ? Resolved
      : R
    : never;

/** Options passed to the `MainWorkerFactory` constructor. */
export interface MainWorkerFactoryOptions {
  workers: WorkerConfig[];
  logLevel?: LogLevel;
}

/** Internal representation of a worker config that has been instantiated. */
export interface MainWorkerFactoryWorker extends WorkerConfig {
  worker: WorkerFactory;
}

/**
 * Runtime configuration for a single worker thread instance.
 *
 * @typeParam TFunc - The worker function type for this instance.
 */
export interface WorkerInstanceConfig<
  TFunc extends WorkerFunction = WorkerFunction,
> {
  /** Name of the parent worker config, used in logs and error objects. */
  workerName: WorkerName;
  /** The function serialised and executed inside the thread (optional if `createWorker` is set). */
  workerFunc?: TFunc;
  /** Factory function returning a Worker instance. */
  createWorker?: () => Worker;
  /** Zero-based shard index assigned to this thread. */
  index: number;
  /** The data payload (full or partitioned shard) sent to the thread. */
  data: unknown;
}

/** The raw `MessageEvent` received when a worker thread succeeds. */
export type WorkerSuccessResult = MessageEvent;
/** The raw `MessageEvent` (or `ErrorEvent`) received when a worker thread fails. */
export type WorkerFailedResult = MessageEvent;

/** Structured result returned by a single worker thread, whether it succeeded or failed. */
export interface WorkerResult {
  /** Zero-based shard index of the thread that produced this result. */
  index: number;
  /** The full instance config used to spawn this thread. */
  workerConfigs: WorkerInstanceConfig;
  /** Present when the thread resolved successfully. */
  successResult?: WorkerSuccessResult;
  /** Present when the thread rejected or posted `{ ok: false }`. */
  failedResult?: WorkerFailedResult;
}

/**
 * Typed wrapper around the settled results from `runWorker`.
 * Carries `T` (the worker's return type) so `collectResults` can infer it.
 *
 * @internal Not part of the public API. `runWorker` now returns `CollectedResult<R>` directly.
 * @deprecated Use the return value of `runWorker` directly.
 * @template T - The worker's return type.
 */
export class TypedSettledResults<T> {
  constructor(public readonly results: PromiseSettledResult<WorkerResult>[]) {}
  /** Never actually exists at runtime — used only for type inference. */
  declare readonly __type: T;
}

/**
 * Options passed to `collectResults` (kept for the opt-out escape hatch).
 * @template T - The type of a single shard result.
 * @template R - The type of the merged result.
 */
export interface CollectOptions<T, R = T[]> {
  /**
   * Custom reducer applied to the array of fulfilled shard values.
   * Runs inside a worker — must be self-contained (no external references).
   * Defaults to a flat array of all shard data values.
   *
   * @example
   * // sum all numbers across shards
   * reducer: (shards) => shards.flat().reduce((a, b) => a + b, 0)
   */
  reducer?: (shards: T[]) => R;
}

/**
 * Options that can be passed alongside `srcData` in `runWorker` to control
 * auto-collection behaviour.
 * @template T - The type of a single shard result.
 * @template R - The type of the merged result.
 */
export interface RunWorkerOptions<T = unknown, R = T[]> {
  /**
   * Custom reducer to merge shard results.
   * Must be a self-contained function (no closures over external variables)
   * since it is serialised via `.toString()` and run inside a worker.
   * Defaults to `(shards) => shards.flat()`.
   */
  reducer?: (shards: T[]) => R;
  /**
   * Set to `false` to skip auto-collection and receive a `TypedSettledResults`
   * object instead of `CollectedResult`. Useful for advanced scenarios where
   * you need to call `collectResults` with custom options manually.
   * @default true
   */
  autoCollect?: boolean;
}

/**
 * Result returned by collectResults
 * @template R - The type of the merged data.
 */
export interface CollectedResult<R> {
  /** The merged output produced by the reducer */
  data: R;
  /** Number of shards that succeeded */
  succeeded: number;
  /** Number of shards that failed (after all retries) */
  failed: number;
  /** Raw rejected results, if any */
  errors: PromiseRejectedResult[];
  /**
   * Present when the worker config has `memory: true`.
   * The ref under which the merged result is stored in MemoryWorker,
   * allowing it to be passed to subsequent workers without re-serializing.
   */
  __memory_ref__?: string;
}

/** A single step in a worker pipeline */
export interface PipelineStep {
  /** Name of the registered worker to run */
  worker: string;
  /** Input data for the first step (subsequent steps receive previous output) */
  srcData?: unknown;
  /** Any additional step parameters, configs, or options forwarded to the worker payload. */
  [key: string]: unknown;
}
