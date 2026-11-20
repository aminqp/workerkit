import {
  WorkerConfig,
  WorkerDataParam,
  TypedSettledResults,
  WorkerReturnType,
  WorkerConfigMap,
  CollectedResult,
  RunWorkerOptions,
} from '../main-worker-factory/types';
import { partitionArray } from '../partition-array';
import { collectWorkerResults, CollectStoreMode } from '../collect-results';
import { terminatedError, throwIfAborted } from '../lifecycle';
import { memoryInput, readsMemoryInput } from '../memory-input';
import { extractTransferable } from '../extract-transferable';
import { RunWorkerContext } from './types';

/**
 * Executes a specific worker with the provided parameters, optionally handling partitioning
 * and data resolution from the memory store.
 *
 * Workers run in Memory mode: they store their results directly into MemoryWorker
 * via a pre-allocated MessagePort. Only `__memory_ref__` tokens return to the main thread.
 * Auto-collect then merges the shards in a reducer worker (also without routing data
 * through the main thread), and a `CollectedResult<R>` is returned.
 *
 * With `memory: true` the reducer also stores the merged result in MemoryWorker and the
 * result carries its `__memory_ref__`; with `memoryOnly: true` only that ref is returned
 * (the result has no `data`).
 *
 * If the factory is terminated while the call runs, it rejects with
 * "MainWorkerFactory has been terminated".
 *
 * @param workerName - The name of the worker to execute (from configured workers).
 * @param rawParams - The parameters to pass to the worker, including optional `srcData` and memory options.
 * @param context - The execution context (provides orchestrator, logger, memory store, proxy, run signal).
 * @returns A CollectedResult containing the merged data and shard stats.
 * @throws {Error} If the worker factory is terminated or the worker is not found.
 * @template TConfigs - A tuple of WorkerConfig configurations.
 * @template TName - The name of the registered worker.
 * @template T - The return type of the worker function.
 * @template R - The merged return type after reducing shards.
 */
export async function executeWorker<
  TConfigs extends readonly WorkerConfig[],
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
  context: RunWorkerContext,
): Promise<CollectedResult<R>> {
  const { signal } = context;
  if (context.isTerminated() || signal.aborted) {
    context.logger.error(
      'Attempted to execute worker after MainWorkerFactory was terminated',
    );
    throw terminatedError();
  }

  const config = context.findWorkerByName(workerName);
  if (!config) {
    context.logger.error(`Worker config not found for worker: "${workerName}"`);
    throw new Error(`Worker "${workerName}" not found`);
  }

  const {
    srcData: rawSrcData,
    reducer,
    autoCollect = true,
    ...otherParams
  } = (rawParams || {}) as {
    srcData?: unknown;
    reducer?: (shards: T[]) => R;
    autoCollect?: boolean;
  } & Record<string, unknown>;

  const memoryRef = otherParams.__memory_ref__ as string | undefined;
  const shouldDeleteMemory = Boolean(otherParams.deleteMemory);
  delete otherParams.__memory_ref__;
  delete otherParams.deleteMemory;

  const threadCount = config.maxConcurrency ?? context.threads;
  // Workers generated from `func`, and defineWorker workers once identified,
  // read input that is in the MemoryWorker themselves (see memory-input.ts).
  const readsInput = readsMemoryInput(config);
  let plan: InputPlan;

  if (rawSrcData === undefined && memoryRef) {
    if (!context.memoryStore.has(memoryRef)) {
      context.logger.error(
        `Attempted to use invalid memory reference: "${memoryRef}"`,
      );
      throw new Error(
        `Memory reference "${memoryRef}" not found in MemoryStore`,
      );
    }
    if (readsInput) {
      // Each worker reads the stored value (or its part) straight from the
      // MemoryWorker: the data never comes to the main thread.
      plan = await planFromMemory(memoryRef, config, threadCount, context);
    } else {
      // A hand-written worker can't read from the MemoryWorker: send it the data.
      const stored = await context.memoryWorkerProxy.get(memoryRef);
      throwIfAborted(signal);
      plan = planFromData(stored, config, threadCount);
    }
  } else if (
    rawSrcData !== undefined &&
    readsInput &&
    threadCount > 1 &&
    !(config.partition && Array.isArray(rawSrcData))
  ) {
    // Every thread needs the whole input: send it to the MemoryWorker once and
    // let the threads read it there, instead of posting a copy to each.
    plan = await planFanOut(rawSrcData, threadCount, context);
  } else {
    plan = planFromData(rawSrcData, config, threadCount);
  }

  const promises = context.orchestrator.createWorkerPromises(
    config,
    workerName,
    { data: plan.data, ...otherParams },
    plan.threads,
    plan.partitioned,
    signal,
  );

  const settled = await Promise.allSettled(promises);
  if (plan.scratchRef) {
    // Workers have read it; retries are over.
    await context.memoryWorkerProxy.delete(plan.scratchRef).catch(() => {});
  }
  throwIfAborted(signal);

  if (shouldDeleteMemory && memoryRef) {
    await context.memoryWorkerProxy.delete(memoryRef);
    context.memoryStore.delete(memoryRef);
  }

  const shardRefs: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const d = result.value.successResult?.data as
        | Record<string, unknown>
        | undefined;
      const ref = d?.__memory_ref__ as string | undefined;
      if (ref) shardRefs.push(ref);
    }
  }

  // Register all returned refs in the main-thread MemoryStore (ref registry)
  for (const ref of shardRefs) context.memoryStore.register(ref);

  const typedSettled = new TypedSettledResults<T>(settled);

  if (!autoCollect) {
    // Escape hatch: return a synthetic CollectedResult with raw settled data
    // to let callers invoke collectResults manually.
    // The TypedSettledResults is attached for compat via the data field.
    const fulfilled = settled.filter((r) => r.status === 'fulfilled').length;
    const errors = settled.filter(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult[];
    return {
      data: typedSettled as unknown as R,
      succeeded: fulfilled,
      failed: errors.length,
      errors,
    };
  }

  const store: CollectStoreMode = config.memoryOnly
    ? 'refOnly'
    : config.memory
      ? 'withData'
      : 'none';

  // Auto-collect: merge shards in a reducer worker (worker-to-MemoryWorker-to-reducer path).
  // With `store`, the reducer also writes the merged result to MemoryWorker itself.
  const collected = await collectWorkerResults<T, R>(
    typedSettled,
    { reducer },
    {
      isTerminated: context.isTerminated,
      trackWorker: context.trackWorker,
      terminateWorker: context.terminateWorker,
      logger: context.logger,
      memoryWorkerProxy: context.memoryWorkerProxy,
      factoryToken: context.factoryToken,
      signal,
    },
    store,
  );

  // Clean up individual shard refs — the merged result (if kept) has its own ref.
  for (const ref of shardRefs) {
    context.memoryStore.delete(ref);
    await context.memoryWorkerProxy.delete(ref);
  }

  if (collected.__memory_ref__) {
    context.memoryStore.register(collected.__memory_ref__);
  }

  if (store === 'refOnly') {
    // memoryOnly: the result carries only the ref — no data.
    const { data: _data, ...refOnly } = collected;
    return refOnly as CollectedResult<R>;
  }

  return collected;
}

/** What each worker of a call receives, and how many workers there are. */
interface InputPlan {
  /** The input, or — when `partitioned` — one entry per worker. */
  data: unknown;
  threads: number;
  partitioned: boolean;
  /** A ref this call stored for its workers to read; deleted afterwards. */
  scratchRef?: string;
}

/** Input posted to the workers by the main thread (the classic path). */
function planFromData(
  srcData: unknown,
  config: WorkerConfig,
  threadCount: number,
): InputPlan {
  if (config.partition && Array.isArray(srcData)) {
    const parts = partitionArray(srcData, threadCount);
    return { data: parts, threads: parts.length, partitioned: true };
  }
  return { data: srcData, threads: threadCount, partitioned: false };
}

/**
 * Input already in the MemoryWorker: every worker gets a placeholder naming
 * the ref — and, when partitioned, its part — and reads the data itself.
 * Only the stored array's length comes to the main thread, to plan the parts.
 */
async function planFromMemory(
  ref: string,
  config: WorkerConfig,
  threadCount: number,
  context: RunWorkerContext,
): Promise<InputPlan> {
  const stored = await context.memoryWorkerProxy.describe(ref);
  throwIfAborted(context.signal);
  if (!stored.exists) {
    throw new Error(`Memory reference "${ref}" not found in MemoryStore`);
  }
  if (config.partition && stored.isArray) {
    const length = stored.length ?? 0;
    if (length > 0 && threadCount <= 0) {
      throw new Error('numChunks must be positive');
    }
    // Same split as partitionArray: min(threads, length) parts.
    const parts = Math.min(threadCount, length);
    return {
      data: Array.from({ length: parts }, (_, index) =>
        memoryInput(ref, { index, count: parts }),
      ),
      threads: parts,
      partitioned: true,
    };
  }
  return { data: memoryInput(ref), threads: threadCount, partitioned: false };
}

/**
 * The same input for every thread: stored in the MemoryWorker once, then
 * read by each thread — one copy leaves the main thread instead of one per
 * thread. Buffers are moved there, as they would be moved to a worker.
 * Input that can't be stored (it can't be cloned) is posted the classic
 * way, so it fails per worker exactly as before.
 */
async function planFanOut(
  srcData: unknown,
  threadCount: number,
  context: RunWorkerContext,
): Promise<InputPlan> {
  let scratchRef: string;
  try {
    scratchRef = await context.memoryWorkerProxy.set(
      srcData,
      undefined,
      extractTransferable(srcData),
    );
  } catch (error) {
    throwIfAborted(context.signal);
    context.logger.info(
      'Could not store the input for its workers; posting it to each',
      error,
    );
    return { data: srcData, threads: threadCount, partitioned: false };
  }
  throwIfAborted(context.signal);
  return {
    data: memoryInput(scratchRef),
    threads: threadCount,
    partitioned: false,
    scratchRef,
  };
}
