import { extractTransferable } from '../extract-transferable';
import { WorkerFunction } from '../main-worker-factory/types';
import {
  MEMORY_INPUT,
  READS_MEMORY_INPUT,
  type MemoryInputSpec,
} from '../memory-input';
import {
  NO_DATASET_ERROR,
  PersistentRequest,
} from '../persistent-manager/protocol';

/**
 * Defines a function to run inside a native Web Worker script, establishing
 * a standard messaging interface that provides full compatibility with `MainWorkerFactory`.
 *
 * This helper wraps your worker logic and automatically handles:
 * - Standard runs (`factory.runWorker()`), storing results in the MemoryWorker when the
 *   factory provides a port, and reading input that is already stored there (a
 *   `__memory_ref__`, or this worker's partition of it) straight from the MemoryWorker.
 * - Worker-to-worker message passing in pipelines (`factory.pipeline()`).
 * - Dataset caching and persistent state (`factory.runPersistent()`): the dataset sent with
 *   a call is cached, later calls without a dataset reuse it, and your function receives
 *   `{ data: cachedDataset, config }`.
 * - Extracting and passing transferable objects (like `ArrayBuffer` or `MessagePort`)
 *   automatically to optimize memory usage without structured cloning overhead.
 * - Catching synchronous and asynchronous errors and formatting them for the main thread.
 *
 * @typeParam TParams - The type of the payload/parameters sent to the worker.
 *                      It typically includes a `data` field alongside optional configurations.
 * @typeParam TResult - The return type of the worker function. Can be a promise or a direct value.
 *
 * @param workerFn - The function containing the worker's execution logic. It takes the parsed
 *                   payload and returns the computed result (or a Promise resolving to it).
 *
 * @example
 * // my-native-worker.ts
 * import { defineWorker } from '@offmain/workerkit/define-worker';
 *
 * // This worker function is compatible with runWorker, pipeline and runPersistent
 * export default defineWorker(async ({ data, options }: { data: number[], options?: { mult?: number } }) => {
 *   const mult = options?.mult ?? 2;
 *   return data.map((x) => x * mult);
 * });
 */
export function defineWorker<TParams = unknown, TResult = unknown>(
  workerFn: WorkerFunction<TParams, TResult | Promise<TResult>>,
): void {
  if (typeof self === 'undefined') return;

  let outputPort: MessagePort | null = null;
  let inputPort: MessagePort | null = null;
  let pendingData: unknown = null;
  let stepParams: Record<string, unknown> = {};

  let memPort: MessagePort | null = null;
  let factoryToken: string | null = null;
  /** False when the port was given only to read the input (a pipeline step). */
  let storeResults = true;
  let memoryRequestCount = 0;

  // Persistent mode (runPersistent) state
  let cachedDataset: unknown;
  let hasDataset = false;
  let cachedTransferables = new Set<Transferable>();

  const postWorkerMessage = (message: unknown, transfer?: Transferable[]) => {
    (
      self as unknown as {
        postMessage: (msg: unknown, transfer?: Transferable[]) => void;
      }
    ).postMessage(message, transfer);
  };

  const errorMessage = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

  /** Sends one request to the MemoryWorker and resolves with its reply. */
  function memoryRequest(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<Record<string, unknown>> {
    const port = memPort!;
    return new Promise((resolve, reject) => {
      const id = `worker_${++memoryRequestCount}`;
      const onReply = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        port.removeEventListener('message', onReply);
        if (event.data.ok) resolve(event.data);
        else
          reject(new Error(event.data.error ?? 'MemoryWorker request failed'));
      };
      port.addEventListener('message', onReply);
      port.postMessage({ ...message, factoryToken, id }, transfer);
    });
  }

  /**
   * Replaces a `__memory_input__` placeholder in `payload.data` with the data
   * it names, read straight from the MemoryWorker.
   */
  async function resolveMemoryInput(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = payload.data as Record<string, unknown> | null | undefined;
    const input = data?.[MEMORY_INPUT] as MemoryInputSpec | undefined;
    if (!input) return payload;
    if (!memPort)
      throw new Error('No MemoryWorker port to read the input from');
    const reply = await memoryRequest(
      input.part
        ? { action: 'GET_PART', ref: input.ref, part: input.part }
        : { action: 'GET', ref: input.ref },
    );
    if (!reply.exists) {
      throw new Error(`Memory reference "${input.ref}" not found`);
    }
    return { ...payload, data: reply.data };
  }

  /** Replies to the main thread, saying this worker reads memory input itself. */
  const reply = (message: Record<string, unknown>, transfer?: Transferable[]) =>
    postWorkerMessage({ ...message, [READS_MEMORY_INPUT]: true }, transfer);

  async function processData(data: unknown) {
    try {
      const payload = await resolveMemoryInput(
        typeof data === 'object' && data !== null && 'data' in data
          ? { ...stepParams, ...(data as Record<string, unknown>) }
          : { data, ...stepParams, index: 0 },
      );
      const output = await workerFn(payload as TParams);
      const transfers = extractTransferable(output);
      if (outputPort) {
        // Pipeline output — forward directly to next worker in chain
        outputPort.postMessage({ ok: true, data: output }, transfers);
      } else if (memPort && storeResults) {
        // Memory path: store in MemoryWorker, post only the ref token. The
        // output's buffers move there; this worker has no further use for them.
        const ref = 'mem_' + crypto.randomUUID();
        await memoryRequest({ action: 'SET', ref, data: output }, transfers);
        reply({ ok: true, __memory_ref__: ref });
      } else {
        // No port (or a read-only one): post the result itself
        reply({ ok: true, data: output }, transfers);
      }
    } catch (err) {
      const result = { ok: false, error: errorMessage(err) };
      if (outputPort) {
        outputPort.postMessage(result);
      } else {
        reply(result);
      }
    }
  }

  async function handlePersistent(msg: PersistentRequest) {
    const { id } = msg;

    if (msg.__persistent__ === 'release') {
      cachedDataset = undefined;
      hasDataset = false;
      cachedTransferables = new Set();
      postWorkerMessage({ ok: true, data: null, type: 'released', id });
      self.close();
      return;
    }

    if (msg.dataset !== undefined) {
      cachedDataset = msg.dataset;
      hasDataset = true;
      cachedTransferables = new Set(extractTransferable(cachedDataset));
    }

    if (!hasDataset) {
      postWorkerMessage({ ok: false, error: NO_DATASET_ERROR, id });
      return;
    }

    try {
      const output = await workerFn({
        data: cachedDataset,
        config: msg.config,
      } as TParams);
      // Never transfer the cached dataset's buffers — that would empty the cache.
      const transfers = extractTransferable(output).filter(
        (t) => !cachedTransferables.has(t),
      );
      postWorkerMessage({ ok: true, data: output, id }, transfers);
    } catch (err) {
      postWorkerMessage({ ok: false, error: errorMessage(err), id });
    }
  }

  self.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;

    // 0. MemoryWorker init message: handle port and token for Memory mode
    if (msg && msg.__init_memory_port__) {
      memPort = (event.ports[0] ?? msg.memPort) as MessagePort | null;
      factoryToken = msg.factoryToken as string | null;
      storeResults = msg.storeResult !== false;
      if (memPort) memPort.start();

      return;
    }

    // 1. Persistent (runPersistent) request — keyed on the namespaced marker so
    //    ordinary payloads that happen to contain `type`/`config` are unaffected.
    if (msg && msg.__persistent__) {
      void handlePersistent(msg as PersistentRequest);
      return;
    }

    // 2. Pipeline ports configuration message
    if (msg && msg.__pipeline_ports__) {
      if (msg.stepParams) {
        stepParams = msg.stepParams as Record<string, unknown>;
      }
      if (msg.outputPort) {
        outputPort = msg.outputPort as MessagePort;
      }
      if (msg.inputPort) {
        inputPort = msg.inputPort as MessagePort;
        inputPort.onmessage = (e: MessageEvent) => {
          if (e.data && e.data.ok === false) {
            if (outputPort) outputPort.postMessage(e.data);
            else postWorkerMessage(e.data);
          } else {
            processData({ data: e.data?.data, ...stepParams, index: 0 });
          }
        };
      }
      if (pendingData !== null) {
        processData(pendingData);
        pendingData = null;
      }
      return;
    }

    // 3. Standalone or first pipeline worker execution
    if (!inputPort) {
      void processData(msg);
    } else {
      pendingData = msg;
    }
  });
}
