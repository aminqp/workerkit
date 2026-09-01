import { extractTransferable } from '../extract-transferable';
import { WorkerFunction } from '../main-worker-factory/types';

/**
 * Defines a function to run inside a native Web Worker script, establishing
 * a standard messaging interface that provides full compatibility with `MainWorkerFactory`.
 *
 * This helper wraps your worker logic and automatically handles:
 * - Standard single-execution runs (`foreman.run()`).
 * - Worker-to-worker message passing in pipelines (`foreman.pipeline()`).
 * - Dataset caching and persistent state (`foreman.runPersistent()`).
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
 * import { defineWorker } from '@offmain/workerkit';
 *
 * // This worker function is compatible with standard runs and pipelines
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

  const postWorkerMessage = (message: unknown, transfer?: Transferable[]) => {
    (
      self as unknown as {
        postMessage: (msg: unknown, transfer?: Transferable[]) => void;
      }
    ).postMessage(message, transfer);
  };

  async function processData(data: unknown) {
    try {
      const payload =
        typeof data === 'object' && data !== null && 'data' in data
          ? { ...stepParams, ...(data as Record<string, unknown>) }
          : { data, ...stepParams, index: 0 };
      const output = await workerFn(payload as TParams);
      const result = { ok: true, data: output };
      const transfers = extractTransferable(output);
      if (outputPort) {
        outputPort.postMessage(result, transfers);
      } else {
        postWorkerMessage(result, transfers);
      }
    } catch (err) {
      const result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      if (outputPort) {
        outputPort.postMessage(result);
      } else {
        postWorkerMessage(result);
      }
    }
  }

  self.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;

    // 1. Pipeline ports configuration message
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

    // 2. Standalone or first pipeline worker execution
    if (!inputPort) {
      processData(msg);
    } else {
      pendingData = msg;
    }
  });
}
