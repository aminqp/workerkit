import {
  CollectOptions,
  CollectedResult,
  TypedSettledResults,
  WorkerResult,
} from '../main-worker-factory/types';
import {
  markErrorHandled,
  onAbort,
  terminatedError,
  throwIfAborted,
} from '../lifecycle';
import { CollectResultsContext, CollectStoreMode } from './types';

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
 * directly without routing through the main thread. With `store` set, the reducer
 * also writes the merged result straight into the MemoryWorker and reports its ref.
 *
 * @template T - The expected type of the data returned from an individual worker.
 * @template R - The expected type of the merged data.
 *
 * @param settled - The settled results (`Promise.allSettled` output) from the workers.
 * @param options - Options for collection, such as a custom `reducer` function.
 * @param context - Context object providing logger, worker tracking, run signal, and MemoryWorkerProxy.
 * @param store - Whether to keep the merged result in the MemoryWorker (see {@link CollectStoreMode}).
 * @returns A promise resolving to the collected results containing the merged data, success count, failure count, and errors.
 * @throws Will throw an error if the `MainWorkerFactory` context has been terminated prior to or during collection.
 */
export async function collectWorkerResults<
  T = unknown,
  R = T extends (infer Item)[] ? Item[] : T[],
>(
  settled: TypedSettledResults<T> | TypedSettledResults<unknown>,
  options: CollectOptions<T, R> = {},
  context: CollectResultsContext,
  store: CollectStoreMode = 'none',
): Promise<CollectedResult<R>> {
  if (context.isTerminated() || context.signal.aborted) {
    context.logger.error(
      'Attempted to collect results after MainWorkerFactory was terminated',
    );
    throw terminatedError();
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

  const reduceOnMainThread = (shards: unknown[]): R => {
    const defaultReducer = (s: unknown[]) => (s as unknown[][]).flat();
    const reducerFn =
      options.reducer ?? (defaultReducer as unknown as (shards: T[]) => R);
    return reducerFn(shards as T[]);
  };

  /** Merges on the main thread, then stores the result if requested. */
  const mergeOnMainThread = async (
    shards: unknown[],
  ): Promise<{ data: R; ref?: string }> => {
    const data = reduceOnMainThread(shards);
    if (store === 'none') return { data };
    const ref = await context.memoryWorkerProxy.set(data);
    return { data, ref };
  };

  let merged: { data?: R; ref?: string };

  if (
    allHaveMemRefs &&
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof MessageChannel !== 'undefined'
  ) {
    try {
      merged = await mergeInReducerWorker<R>(
        memRefs as string[],
        reducerSrc,
        store,
        context,
      );
    } catch (error) {
      if (context.signal.aborted) throw terminatedError();
      // The failure itself was already logged as an error where it happened
      // (or, if the worker could not be created, falling back is expected).
      context.logger.info(
        'Reducer worker failed; merging on the main thread instead',
        error,
      );
      const shards = await Promise.all(
        (memRefs as string[]).map((ref) => context.memoryWorkerProxy.get(ref)),
      );
      merged = await mergeOnMainThread(shards);
    }
  } else if (!allHaveMemRefs) {
    // Legacy path: shards arrived as raw data (e.g. from createWorker bundler workers)
    merged = await mergeOnMainThread(
      fulfilled.map((result) => result.value.successResult!.data),
    );
  } else {
    // No Worker/Blob support — merge on main thread using MemoryWorkerProxy
    const shards = await Promise.all(
      (memRefs as string[]).map((ref) => context.memoryWorkerProxy.get(ref)),
    );
    merged = await mergeOnMainThread(shards);
  }
  throwIfAborted(context.signal);

  return {
    data: merged.data as R,
    succeeded: fulfilled.length,
    failed: errors.length,
    errors,
    ...(merged.ref ? { __memory_ref__: merged.ref } : {}),
  };
}

/**
 * Runs the reducer in an ephemeral worker that reads the shards from — and,
 * when `store` is set, writes the merged result to — the MemoryWorker directly.
 * The worker is tracked by the factory and stopped if the factory terminates.
 */
async function mergeInReducerWorker<R>(
  refs: string[],
  reducerSrc: string,
  store: CollectStoreMode,
  context: CollectResultsContext,
): Promise<{ data?: R; ref?: string }> {
  // Allocate a direct port from MemoryWorker to the reducer worker.
  // The reducer fetches shards directly — the main thread never holds the data.
  const reducerPort = await context.memoryWorkerProxy.allocateWorkerPort();
  throwIfAborted(context.signal);

  const workerSrc = `
    const refs = ${JSON.stringify(refs)};
    const factoryToken = ${JSON.stringify(context.factoryToken)};
    const store = ${JSON.stringify(store)};
    const reducer = ${reducerSrc};

    // Sends one request to the MemoryWorker and resolves with its reply.
    const request = (memPort, message, matches) =>
      new Promise((resolve, reject) => {
        memPort.addEventListener('message', function handler(e) {
          if (!matches(e.data)) return;
          memPort.removeEventListener('message', handler);
          if (e.data.ok) resolve(e.data);
          else reject(new Error(e.data.error));
        });
        memPort.postMessage(message);
      });

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
          request(
            memPort,
            { action: 'GET', factoryToken, ref, id: 'fetch_' + ref },
            (reply) => reply && reply.id === 'fetch_' + ref,
          ).then((reply) => reply.data)
        ));

        const result = reducer(shards);

        if (store === 'none') {
          self.postMessage({ ok: true, data: result });
          return;
        }

        // Store the merged result directly in MemoryWorker
        const ref = 'mem_' + crypto.randomUUID();
        await request(
          memPort,
          { action: 'SET', factoryToken, ref, data: result, id: 'store_' + ref },
          (reply) => reply && reply.id === 'store_' + ref,
        );
        self.postMessage(
          store === 'refOnly'
            ? { ok: true, __memory_ref__: ref }
            : { ok: true, data: result, __memory_ref__: ref },
        );
      } catch (error) {
        self.postMessage({ ok: false, error: String(error) });
      } finally {
        self.close();
      }
    });
  `;

  return new Promise((resolve, reject) => {
    // The script embeds this merge's shard refs, so it is never reused: its
    // blob URL is revoked as soon as the worker is done, instead of cached.
    const url = URL.createObjectURL(
      new Blob([workerSrc], { type: 'application/javascript' }),
    );
    let worker: Worker;
    try {
      worker = context.trackWorker(new Worker(url));
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    const stop = () => {
      context.terminateWorker(worker);
      URL.revokeObjectURL(url);
    };

    const stopListening = onAbort(context.signal, () => {
      stop();
      reject(terminatedError());
    });
    const finish = () => {
      stopListening();
      stop();
    };

    worker.onmessage = (event) => {
      finish();
      if (event.data.ok) {
        resolve({
          data: event.data.data as R | undefined,
          ref: event.data.__memory_ref__ as string | undefined,
        });
      } else {
        context.logger.error(
          'Collect results reducer worker failed',
          event.data.error,
        );
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      markErrorHandled(event);
      finish();
      context.logger.error(
        'Collect results reducer worker encountered an error event',
        event,
      );
      reject(event);
    };

    // Transfer the MemoryWorker port to the reducer worker — direct path
    worker.postMessage({ __start__: true }, [reducerPort]);
  });
}
