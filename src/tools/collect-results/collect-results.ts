import {
  CollectOptions,
  CollectedResult,
  TypedSettledResults,
  WorkerResult,
} from '../main-worker-factory/types';
import { CollectResultsContext } from './types';

/**
 * Collects and merges the results of multiple worker execution promises.
 *
 * This function processes an array of settled promises from worker executions,
 * segregates them into fulfilled and rejected results, and then reduces (merges)
 * the fulfilled data into a single combined output.
 *
 * If a `reducer` is provided in `options`, it will be used to merge the shards.
 * Otherwise, a default reducer that flats the array will be used.
 * By default, the merge operation is offloaded to an ephemeral Web Worker to avoid
 * blocking the main thread, especially for large datasets.
 *
 * It also handles special `memoryOnly` reference payloads where the worker result
 * is just a token reference rather than actual serialized data.
 *
 * @template T - The expected type of the data returned from an individual worker.
 * @template R - The expected type of the merged data. Defaults to `T[]` if `T` is not an array, or `Item[]` if `T` is `Item[]`.
 *
 * @param settled - The settled results (`Promise.allSettled` output) from the workers.
 * @param options - Options for collection, such as a custom `reducer` function.
 * @param context - Context object providing logger, worker tracking, and termination checks.
 * @returns A promise resolving to the collected results containing the merged data, success count, failure count, and errors.
 * @throws Will throw an error if the `MainWorkerFactory` context has been terminated prior to collection.
 */
export async function collectWorkerResults<
  T = unknown,
  R = T extends (infer Item)[] ? Item[] : T[],
>(
  settled: TypedSettledResults<T> | TypedSettledResults<unknown>,
  options: CollectOptions<T, R> = {},
  context: CollectResultsContext,
): Promise<CollectedResult<R>> {
  if (context.isTerminated()) {
    context.logger.error(
      'Attempted to collect results after MainWorkerFactory was terminated',
    );
    throw new Error('MainWorkerFactory has been terminated');
  }

  const fulfilled = settled.results.filter(
    (result) => result.status === 'fulfilled',
  ) as PromiseFulfilledResult<WorkerResult>[];
  const errors = settled.results.filter(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult[];

  // If all fulfilled shards returned a memoryOnly reference payload with the same token,
  // return the single memory reference payload instead of an array of duplicate ref objects.
  const isMemoryOnlyRef =
    fulfilled.length > 0 &&
    fulfilled.every((result) => {
      const responseData = result.value.successResult?.data as Record<
        string,
        unknown
      >;
      return (
        responseData &&
        typeof responseData === 'object' &&
        '__memory_ref__' in responseData &&
        !('data' in responseData)
      );
    });

  if (isMemoryOnlyRef) {
    const firstData = fulfilled[0].value.successResult!.data as R;
    return {
      data: firstData,
      succeeded: fulfilled.length,
      failed: errors.length,
      errors,
    };
  }

  // Check if memory ref payload with data (memory: true)
  const isMemoryRefWithData =
    fulfilled.length > 0 &&
    fulfilled.every((result) => {
      const responseData = result.value.successResult?.data as Record<
        string,
        unknown
      >;
      return (
        responseData &&
        typeof responseData === 'object' &&
        '__memory_ref__' in responseData &&
        'data' in responseData
      );
    });

  const memoryRefToken = isMemoryRefWithData
    ? ((fulfilled[0].value.successResult!.data as { __memory_ref__: string })
        .__memory_ref__ as string)
    : undefined;

  const shards = fulfilled.map((result) => {
    const responseData = result.value.successResult!.data;
    if (
      isMemoryRefWithData &&
      responseData &&
      typeof responseData === 'object' &&
      'data' in responseData
    ) {
      return (responseData as { data: T }).data;
    }
    return responseData as T;
  });

  // Build a self-contained merge function for the worker
  const reducerSrc = options.reducer
    ? options.reducer.toString()
    : '(shards) => shards.flat()';

  let mergeResult: R;

  if (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    try {
      mergeResult = await new Promise<R>((resolve, reject) => {
        const workerSrc = `
          const reducer = ${reducerSrc};
          self.addEventListener('message', (event) => {
            try {
              const result = reducer(event.data);
              self.postMessage({ ok: true, data: result });
            } catch (error) {
              self.postMessage({ ok: false, error: String(error) });
            }
          });
        `;
        const blob = new Blob([workerSrc], {
          type: 'application/javascript',
        });
        const worker = context.trackWorker(
          new Worker(URL.createObjectURL(blob)),
        );

        worker.onmessage = (event) => {
          context.terminateWorker(worker);
          if (event.data.ok) resolve(event.data.data);
          else {
            context.logger.error(
              'Collect results reducer worker failed',
              event.data.error,
            );
            reject(new Error(event.data.error));
          }
        };
        worker.onerror = (event) => {
          context.terminateWorker(worker);
          context.logger.error(
            'Collect results reducer worker encountered an error event',
            event,
          );
          reject(event);
        };
        worker.postMessage(shards);
      });
    } catch {
      const defaultReducer = (s: unknown[]) => (s as unknown[][]).flat();
      const reducer = options.reducer ?? defaultReducer;
      mergeResult = reducer(shards as T[]) as R;
    }
  } else {
    const defaultReducer = (s: unknown[]) => (s as unknown[][]).flat();
    const reducer = options.reducer ?? defaultReducer;
    mergeResult = reducer(shards as T[]) as R;
  }

  const finalData = isMemoryRefWithData
    ? ({ data: mergeResult, __memory_ref__: memoryRefToken } as unknown as R)
    : mergeResult;

  return {
    data: finalData,
    succeeded: fulfilled.length,
    failed: errors.length,
    errors,
  };
}
