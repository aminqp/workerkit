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
 *
 * The merge operation is offloaded to an ephemeral Web Worker. The reducer worker
 * receives a direct `MessagePort` to the MemoryWorker, so it fetches shard data
 * directly without routing through the main thread.
 *
 * @template T - The expected type of the data returned from an individual worker.
 * @template R - The expected type of the merged data.
 *
 * @param settled - The settled results (`Promise.allSettled` output) from the workers.
 * @param options - Options for collection, such as a custom `reducer` function.
 * @param context - Context object providing logger, worker tracking, termination checks, and MemoryWorkerProxy.
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

  if (fulfilled.length === 0) {
    return {
      data: [] as unknown as R,
      succeeded: 0,
      failed: errors.length,
      errors,
    };
  }

  // Collect the memory refs from settled results.
  // Workers now store their results in MemoryWorker and only post __memory_ref__ tokens.
  const memRefs = fulfilled.map((result) => {
    const d = result.value.successResult?.data as
      | Record<string, unknown>
      | undefined;
    return d?.__memory_ref__ as string | undefined;
  });

  const allHaveMemRefs = memRefs.every((ref) => typeof ref === 'string');

  // Build the reducer source — must be self-contained
  const reducerSrc = options.reducer
    ? options.reducer.toString()
    : '(shards) => shards.flat()';

  let mergeResult: R;

  if (
    allHaveMemRefs &&
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof MessageChannel !== 'undefined'
  ) {
    // Allocate a direct port from MemoryWorker to the reducer worker.
    // The reducer fetches shards directly — the main thread never holds the data.
    const reducerPort = await context.memoryWorkerProxy.allocateWorkerPort();

    const workerSrc = `
      const refs = ${JSON.stringify(memRefs)};
      const factoryToken = ${JSON.stringify(context.factoryToken)};
      const reducer = ${reducerSrc};

    // collect-results.ts

      self.addEventListener('message', async (event) => {
        // event.ports[0] is the direct line to MemoryWorker
        const memPort = event.ports[0];
        if (!memPort) {
          self.postMessage({ ok: false, error: 'No MemoryWorker port provided' });
          self.close();
          return;
        }
        memPort.start();

        try {
          // Fetch each shard directly from MemoryWorker
          const shards = await Promise.all(refs.map((ref) =>
            new Promise((resolve, reject) => {
              const reqId = 'fetch_' + ref;
              memPort.addEventListener('message', function handler(e) {
                if (e.data && e.data.ref === ref) {
                  memPort.removeEventListener('message', handler);
                  if (e.data.ok) resolve(e.data.data);
                  else reject(new Error(e.data.error));
                }
              });
              memPort.postMessage({ action: 'GET', factoryToken, ref, id: reqId });
            })
          ));

          const result = reducer(shards);
          self.postMessage({ ok: true, data: result });
        } catch (error) {
          self.postMessage({ ok: false, error: String(error) });
        } finally {
          self.close();
        }
      });
    `;

    try {
      mergeResult = await new Promise<R>((resolve, reject) => {
        const blob = new Blob([workerSrc], { type: 'application/javascript' });
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

        // Transfer the MemoryWorker port to the reducer worker — direct path
        worker.postMessage({ __start__: true }, [reducerPort]);
      });
    } catch {
      // Fallback: fetch shards on main thread and merge locally
      const shards = await Promise.all(
        (memRefs as string[]).map((ref) => context.memoryWorkerProxy.get(ref)),
      );
      const defaultReducer = (s: unknown[]) => (s as unknown[][]).flat();
      const reducerFn =
        options.reducer ?? (defaultReducer as unknown as (shards: T[]) => R);
      mergeResult = reducerFn(shards as T[]);
    }
  } else if (!allHaveMemRefs) {
    // Legacy path: shards arrived as raw data (e.g. from createWorker bundler workers)
    const shards = fulfilled.map((result) => {
      const d = result.value.successResult!.data;
      return d as T;
    });
    const defaultReducer = (s: unknown[]) => (s as unknown[][]).flat();
    const reducerFn =
      options.reducer ?? (defaultReducer as unknown as (shards: T[]) => R);
    mergeResult = reducerFn(shards);
  } else {
    // No Worker/Blob support — merge on main thread using MemoryWorkerProxy
    const shards = await Promise.all(
      (memRefs as string[]).map((ref) => context.memoryWorkerProxy.get(ref)),
    );
    const defaultReducer = (s: unknown[]) => (s as unknown[][]).flat();
    const reducerFn =
      options.reducer ?? (defaultReducer as unknown as (shards: T[]) => R);
    mergeResult = reducerFn(shards as T[]);
  }

  return {
    data: mergeResult,
    succeeded: fulfilled.length,
    failed: errors.length,
    errors,
  };
}
