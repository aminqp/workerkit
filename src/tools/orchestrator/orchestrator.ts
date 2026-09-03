import {
  WorkerConfig,
  WorkerInstanceConfig,
  WorkerResult,
} from '../main-worker-factory/types';
import { WorkerFactory, WorkerMode } from '../worker-factory';
import { extractTransferable } from '../extract-transferable';
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
 */
export class WorkerOrchestrator {
  constructor(private context: OrchestratorContext) {}

  createWorkerPromises(
    config: WorkerConfig,
    workerName: string,
    srcWorkerData: { data: unknown } & Record<string, unknown>,
    threadCount: number,
    isPartitioned: boolean,
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
      );
    });
  }

  async runWorkerWithRetry(
    instanceConfig: WorkerInstanceConfig,
    retryCount = 2,
  ): Promise<WorkerResult> {
    try {
      return await this.initiateWorker(instanceConfig);
    } catch (error) {
      if (retryCount > 0) {
        this.context.logger.info(
          `Worker ${instanceConfig.index} failed, retrying (${retryCount} left):`,
          error,
        );
        return this.runWorkerWithRetry(instanceConfig, retryCount - 1);
      }
      this.context.logger.error(`Worker failed after all retries:`, error);
      throw error;
    }
  }

  private async initiateWorker({
    workerFunc,
    createWorker,
    workerName,
    index,
    data,
  }: WorkerInstanceConfig): Promise<WorkerResult> {
    // Allocate a direct MessagePort to MemoryWorker for this computing worker.
    // The worker will store its result there and only post back a ref token.
    const memPort = await this.context.memoryWorkerProxy.allocateWorkerPort();

    return new Promise((resolve, reject) => {
      if (this.context.isTerminated()) {
        reject(new Error('MainWorkerFactory has been terminated'));
        return;
      }

      const factory = new WorkerFactory(workerFunc, {
        createWorker,
        mode: WorkerMode.Memory,
      });
      const raw = this.context.trackWorker(factory.getWorker);

      raw.onerror = (event) => {
        this.context.terminateWorker(raw);
        reject({
          index,
          workerConfigs: {
            workerFunc,
            createWorker,
            workerName,
            index,
            data,
          },
          failedResult: event,
        });
      };

      raw.onmessage = (event) => {
        if (event.data?.ok === false) {
          this.context.terminateWorker(raw);
          reject({
            index,
            workerConfigs: {
              workerFunc,
              createWorker,
              workerName,
              index,
              data,
            },
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
          workerConfigs: {
            workerFunc,
            createWorker,
            workerName,
            index,
            data,
          },
          successResult: new MessageEvent('message', {
            data: payloadData,
          }),
        });
        this.context.terminateWorker(raw);
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
