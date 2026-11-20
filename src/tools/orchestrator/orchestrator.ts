import {
  WorkerConfig,
  WorkerInstanceConfig,
  WorkerResult,
} from '../main-worker-factory/types';
import { WorkerFactory, WorkerMode } from '../worker-factory';
import { extractTransferable } from '../extract-transferable';
import {
  markErrorHandled,
  onAbort,
  terminatedError,
  throwIfAborted,
} from '../lifecycle';
import { noteMemoryInputReader } from '../memory-input';
import { OrchestratorContext } from './types';

/**
 * WorkerOrchestrator manages the lifecycle and execution of dynamically spawned Web Workers.
 *
 * Responsibilities:
 * - Spawns requested worker instances based on a provided configuration.
 * - Slices and partitions data payloads (if `isPartitioned` is true) to distribute work.
 * - Handles auto-retries for failing workers without bubbling up errors prematurely.
 * - Integrates with the context to track active workers and safely clean them up upon completion.
 * - Standardizes the result wrapping into structured `WorkerResult` objects.
 * - Stops and rejects in-flight work when the factory is terminated (via `signal`).
 */
export class WorkerOrchestrator {
  constructor(private context: OrchestratorContext) {}

  createWorkerPromises(
    config: WorkerConfig,
    workerName: string,
    srcWorkerData: { data: unknown } & Record<string, unknown>,
    threadCount: number,
    isPartitioned: boolean,
    signal: AbortSignal = this.context.signal,
  ): Promise<WorkerResult>[] {
    const { data: srcData, ...otherParams } = srcWorkerData;

    return Array.from({ length: threadCount }, (_, index) => {
      const data =
        isPartitioned && Array.isArray(srcData) ? srcData[index] : srcData;
      return this.runWorkerWithRetry(
        {
          workerFunc: config.func,
          createWorker: config.createWorker,
          workerName,
          index,
          data: { data, ...otherParams },
        },
        config.retries,
        signal,
      );
    });
  }

  /**
   * Runs one worker instance, retrying on failure.
   *
   * A call whose `signal` has been aborted (the factory was terminated) is
   * never retried — even if `reset()` has since started a new run.
   */
  async runWorkerWithRetry(
    instanceConfig: WorkerInstanceConfig,
    retryCount = 2,
    signal: AbortSignal = this.context.signal,
  ): Promise<WorkerResult> {
    try {
      return await this.initiateWorker(instanceConfig, signal);
    } catch (error) {
      if (signal.aborted) throw terminatedError();
      if (retryCount > 0) {
        this.context.logger.info(
          `Worker ${instanceConfig.index} failed, retrying (${retryCount} left):`,
          error,
        );
        return this.runWorkerWithRetry(instanceConfig, retryCount - 1, signal);
      }
      this.context.logger.error(`Worker failed after all retries:`, error);
      throw error;
    }
  }

  private async initiateWorker(
    { workerFunc, createWorker, workerName, index, data }: WorkerInstanceConfig,
    signal: AbortSignal,
  ): Promise<WorkerResult> {
    if (this.context.isTerminated()) throw terminatedError();
    throwIfAborted(signal);

    // Allocate a direct MessagePort to MemoryWorker for this computing worker.
    // The worker will store its result there and only post back a ref token.
    const memPort = await this.context.memoryWorkerProxy.allocateWorkerPort();
    if (signal.aborted) {
      memPort.close?.();
      throw terminatedError();
    }

    const workerConfigs = { workerFunc, createWorker, workerName, index, data };

    return new Promise((resolve, reject) => {
      const factory = new WorkerFactory(workerFunc, {
        createWorker,
        mode: WorkerMode.Memory,
      });
      const raw = this.context.trackWorker(factory.getWorker);

      const stopListening = onAbort(signal, () => {
        this.context.terminateWorker(raw);
        reject(terminatedError());
      });
      const finish = () => {
        stopListening();
        this.context.terminateWorker(raw);
      };

      raw.onerror = (event) => {
        markErrorHandled(event);
        finish();
        reject({ index, workerConfigs, failedResult: event });
      };

      raw.onmessage = (event) => {
        finish();
        // A defineWorker worker marks its replies: from now on it is sent
        // placeholders and reads memory input itself (see memory-input.ts).
        noteMemoryInputReader(createWorker, event.data);
        if (event.data?.ok === false) {
          reject({
            index,
            workerConfigs,
            failedResult: new ErrorEvent('error', {
              message: event.data.error,
            }),
          });
          return;
        }

        // Memory mode: worker posts { ok: true, __memory_ref__ }
        // Legacy fallback: worker posts { ok: true, data: ... }
        const memRef = event.data?.__memory_ref__ as string | undefined;
        const payloadData =
          memRef !== undefined
            ? { __memory_ref__: memRef }
            : event.data?.ok !== undefined
              ? event.data.data
              : event.data;

        resolve({
          index,
          workerConfigs,
          successResult: new MessageEvent('message', { data: payloadData }),
        });
      };

      const payload = {
        index,
        ...(Array.isArray(data) ? { data } : (data as Record<string, unknown>)),
      };

      // First: send the MemoryWorker port as a Transferable init message.
      // The worker will queue any computation payload until this is received.
      raw.postMessage(
        {
          __init_memory_port__: true,
          factoryToken: this.context.factoryToken,
        },
        [memPort],
      );

      // Then: send the actual computation payload.
      raw.postMessage(payload, extractTransferable(payload));
    });
  }
}
