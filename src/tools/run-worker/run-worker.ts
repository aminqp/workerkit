import {
  WorkerConfig,
  WorkerDataParam,
  TypedSettledResults,
  WorkerReturnType,
  WorkerConfigMap,
  WorkerResult,
} from '../main-worker-factory/types';
import { partitionArray } from '../partition-array';
import { RunWorkerContext } from './types';

/**
 * Processes successful worker results, stores them in the MemoryStore, and mutates
 * the original PromiseSettledResult objects to contain references to the cached data.
 *
 * @param settled - Array of settled promise results from worker executions.
 * @param options - Configuration options for memory storage and partitioning.
 * @param context - The execution context, containing the MemoryStore.
 */
export function storeWorkerMemoryResult(
  settled: PromiseSettledResult<WorkerResult>[],
  {
    memoryOnly,
    shouldPartition,
  }: { memoryOnly: boolean; shouldPartition: boolean },
  context: RunWorkerContext,
): void {
  const fulfilledResults = settled.filter(
    (result): result is PromiseFulfilledResult<WorkerResult> =>
      result.status === 'fulfilled' && Boolean(result.value.successResult),
  );

  if (fulfilledResults.length === 0) return;

  const shardOutputs = fulfilledResults.map(
    (result) => result.value.successResult!.data,
  );

  const combinedOutput =
    shouldPartition && shardOutputs.every(Array.isArray)
      ? shardOutputs.flat()
      : shardOutputs.length === 1
        ? shardOutputs[0]
        : shardOutputs;

  const ref = context.memoryStore.set(combinedOutput);

  for (const res of fulfilledResults) {
    const newPayload = memoryOnly
      ? { __memory_ref__: ref }
      : { data: res.value.successResult!.data, __memory_ref__: ref };

    res.value.successResult = new MessageEvent('message', {
      data: newPayload,
    });
  }
}

/**
 * Executes a specific worker with the provided parameters, optionally handling partitioning
 * and data resolution from the memory store.
 *
 * @param workerName - The name of the worker to execute (from configured workers).
 * @param rawParams - The parameters to pass to the worker, including optional `srcData` and memory options.
 * @param context - The execution context (provides orchestrator, logger, memory store).
 * @returns A TypedSettledResults instance containing the settled promises of all worker threads.
 * @throws {Error} If the worker factory is terminated or the worker is not found.
 */
export async function executeWorker<
  TConfigs extends readonly WorkerConfig[],
  TName extends keyof WorkerConfigMap<TConfigs> & string,
>(
  workerName: TName,
  rawParams: {
    srcData?: WorkerDataParam<WorkerConfigMap<TConfigs>[TName]>;
    __memory_ref__?: string;
    deleteMemory?: boolean;
  } & Record<string, unknown>,
  context: RunWorkerContext,
): Promise<
  TypedSettledResults<WorkerReturnType<WorkerConfigMap<TConfigs>[TName]>>
> {
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

  const { srcData: rawSrcData, ...otherParams } = (rawParams || {}) as {
    srcData?: unknown;
  } & Record<string, unknown>;

  let srcData = rawSrcData;

  // Memory Reference Resolution:
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
    srcData = context.memoryStore.get(memoryRef);
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
    context.memoryStore.delete(memoryRef);
  }

  if (config.memoryOnly || config.memory) {
    storeWorkerMemoryResult(
      settled,
      {
        memoryOnly: Boolean(config.memoryOnly),
        shouldPartition,
      },
      context,
    );
  }

  return new TypedSettledResults(settled);
}
