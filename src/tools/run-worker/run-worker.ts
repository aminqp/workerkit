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
import { collectWorkerResults } from '../collect-results';
import { RunWorkerContext } from './types';

/**
 * Executes a specific worker with the provided parameters, optionally handling partitioning
 * and data resolution from the memory store.
 *
 * Workers now run in Memory mode: they store their results directly into MemoryWorker
 * via a pre-allocated MessagePort. Only `__memory_ref__` tokens return to the main thread.
 * Auto-collect is then triggered to merge shards in a reducer worker (also without
 * routing data through the main thread), and a `CollectedResult<R>` is returned.
 *
 * @param workerName - The name of the worker to execute (from configured workers).
 * @param rawParams - The parameters to pass to the worker, including optional `srcData` and memory options.
 * @param context - The execution context (provides orchestrator, logger, memory store, proxy).
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
  if (context.isTerminated()) {
    context.logger.error(
      'Attempted to execute worker after MainWorkerFactory was terminated',
    );
    return Promise.reject(new Error('MainWorkerFactory has been terminated'));
  }

  const config = context.findWorkerByName(workerName);
  if (!config) {
    context.logger.error(`Worker config not found for worker: "${workerName}"`);
    return Promise.reject(new Error(`Worker "${workerName}" not found`));
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

  let srcData = rawSrcData;

  // Memory Reference Resolution: if srcData is omitted but a __memory_ref__ is provided,
  // fetch the data from MemoryWorker.
  const memoryRef = otherParams.__memory_ref__ as string | undefined;
  const shouldDeleteMemory = Boolean(otherParams.deleteMemory);

  if (srcData === undefined && memoryRef) {
    if (!context.memoryStore.has(memoryRef)) {
      context.logger.error(
        `Attempted to use invalid memory reference: "${memoryRef}"`,
      );
      return Promise.reject(
        new Error(`Memory reference "${memoryRef}" not found in MemoryStore`),
      );
    }
    // Fetch from MemoryWorker — data stays off main thread until the worker needs it
    srcData = await context.memoryWorkerProxy.get(memoryRef);
    delete otherParams.__memory_ref__;
    delete otherParams.deleteMemory;
  } else {
    delete otherParams.deleteMemory;
  }

  const threadCount = config.maxConcurrency ?? context.threads;
  const shouldPartition = Boolean(Array.isArray(srcData) && config.partition);

  const processedData = shouldPartition
    ? partitionArray(srcData as unknown[], threadCount)
    : srcData;

  const actualThreadCount =
    shouldPartition && Array.isArray(processedData)
      ? processedData.length
      : threadCount;

  const promises = context.orchestrator.createWorkerPromises(
    config,
    workerName,
    { data: processedData, ...otherParams },
    actualThreadCount,
    shouldPartition,
  );

  const settled = await Promise.allSettled(promises);

  if (shouldDeleteMemory && memoryRef) {
    await context.memoryWorkerProxy.delete(memoryRef);
    context.memoryStore.delete(memoryRef);
  }

  // Register all returned refs in the main-thread MemoryStore (ref registry)
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const d = result.value.successResult?.data as
        | Record<string, unknown>
        | undefined;
      const ref = d?.__memory_ref__ as string | undefined;
      if (ref) context.memoryStore.register(ref);
    }
  }

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

  // Auto-collect: merge shards in a reducer worker (worker-to-MemoryWorker-to-reducer path)
  const collected = await collectWorkerResults<T, R>(
    typedSettled,
    { reducer },
    {
      isTerminated: () => context.isTerminated(),
      trackWorker: context.orchestrator['context']
        ? (w: Worker) => w
        : (w: Worker) => w,
      terminateWorker: (_w: Worker) => {},
      logger: context.logger,
      memoryWorkerProxy: context.memoryWorkerProxy,
      factoryToken: context.factoryToken,
    },
  );

  // If worker config has memory: true, preserve the merged result in MemoryWorker
  // and attach the ref. Otherwise clean up all shard refs.
  const shouldPreserveMemory = Boolean(config.memory || config.memoryOnly);

  // Clean up individual shard refs (merged result is now in MemoryWorker if memory:true)
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const d = result.value.successResult?.data as
        | Record<string, unknown>
        | undefined;
      const ref = d?.__memory_ref__ as string | undefined;
      if (ref) {
        context.memoryStore.delete(ref);
        await context.memoryWorkerProxy.delete(ref);
      }
    }
  }

  if (shouldPreserveMemory) {
    // Store the merged result in MemoryWorker and surface the ref
    const mergedRef = await context.memoryWorkerProxy.set(collected.data);
    context.memoryStore.register(mergedRef);
    return { ...collected, __memory_ref__: mergedRef };
  }

  return collected;
}
