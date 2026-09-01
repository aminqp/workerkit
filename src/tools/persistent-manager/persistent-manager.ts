import { WorkerFactory } from '../worker-factory';
import { WorkerMode } from '../worker-factory/worker-factory';
import { extractTransferable } from '../extract-transferable';
import { PersistentManagerContext } from './types';

export class PersistentWorkerManager {
  private readonly _persistentWorkers: Map<string, Worker> = new Map();

  constructor(private context: PersistentManagerContext) {}

  async runPersistent<TResult = unknown>(
    workerName: string,
    params: { dataset?: unknown; config: unknown },
  ): Promise<TResult> {
    if (this.context.isTerminated()) {
      this.context.logger.error(
        'Attempted to run persistent worker after MainWorkerFactory was terminated',
      );
      throw new Error('MainWorkerFactory has been terminated');
    }

    const config = this.context.findWorkerByName(workerName);
    if (!config) {
      this.context.logger.error(
        `Persistent worker config not found for worker: "${workerName}"`,
      );
      throw new Error(`Worker "${workerName}" not found`);
    }

    // Get or create the persistent worker
    let raw = this._persistentWorkers.get(workerName);
    if (!raw) {
      const factory = new WorkerFactory(config.func, {
        mode: WorkerMode.Persistent,
        createWorker: config.createWorker,
      });
      raw = this.context.trackWorker(factory.getWorker);
      this.context.logger.verbose(
        `Created persistent worker for ${workerName}`,
      );
      this._persistentWorkers.set(workerName, raw);
    }

    return new Promise<TResult>((resolve, reject) => {
      raw!.onmessage = (event) => {
        if (event.data?.ok === false) {
          this.context.logger.error(
            `Persistent worker ${workerName} failed`,
            event.data.error,
          );
          reject(new Error(event.data.error));
        } else {
          resolve(event.data?.data as TResult);
        }
      };
      raw!.onerror = (event) => {
        this.context.logger.error(
          `Persistent worker ${workerName} encountered an error event`,
          event,
        );
        reject(event);
      };

      const message: { type: string; config: unknown; dataset?: unknown } = {
        type: 'run',
        config: params.config,
      };
      if (params.dataset !== undefined) {
        message.dataset = params.dataset;
      }
      raw!.postMessage(message, extractTransferable(message));
    });
  }

  release(workerName: string): void {
    const raw = this._persistentWorkers.get(workerName);
    if (raw) {
      try {
        raw.postMessage({ type: 'release' });
      } catch {
        // Ignore
      }
      this.context.terminateWorker(raw);
      this._persistentWorkers.delete(workerName);
    }
  }

  terminateAll(): void {
    for (const worker of this._persistentWorkers.values()) {
      try {
        worker.postMessage({ type: 'release' });
      } catch {
        // Ignore
      }
      this.context.terminateWorker(worker);
    }
    this._persistentWorkers.clear();
  }
}
