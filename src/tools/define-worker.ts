import { extractTransferable } from './main-worker-factory/main-worker-factory';
import { WorkerFunction } from './main-worker-factory/types';

/**
 * Defines and exports a function to run inside a native Web Worker script,
 * providing full compatibility with `MainWorkerFactory` features including
 * standard runs, worker-to-worker pipelines (`foreman.pipeline()`), and
 * dataset caching (`foreman.runPersistent()`).
 *
 * @typeParam TParams - The type of the payload sent to the worker.
 * @typeParam TResult - The return type of the worker function.
 *
 * @param workerFn - The worker execution function.
 *
 * @example
 * // my-native-worker.ts
 * import { defineWorker } from '@offmain/workerkit';
 *
 * export default defineWorker(async ({ data }: { data: number[] }) => {
 *   return data.map((x) => x * 2);
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
