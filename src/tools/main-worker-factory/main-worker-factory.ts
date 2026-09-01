import {
  CollectOptions,
  CollectedResult,
  PipelineStep,
  WorkerConfig,
  WorkerConfigMap,
  WorkerDataParam,
  WorkerFunction,
  WorkerReturnType,
  TypedSettledResults,
  MemoryStats,
} from './types';
import { MemoryStore } from '../memory-store';
import { Logger, LogLevel } from '../logger';
import { executeWorker } from '../run-worker';

// Import extracted modules
import { extractTransferable } from '../extract-transferable';
import { partitionArray } from '../partition-array';
import { executePipeline } from '../pipeline';
import { collectWorkerResults } from '../collect-results';
import { PersistentWorkerManager } from '../persistent-manager';
import { WorkerOrchestrator } from '../orchestrator';

export { extractTransferable };

class MainWorkerFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TConfigs extends readonly WorkerConfig<WorkerFunction<any, any>>[],
> {
  private readonly _workers: WorkerConfig[];
  private readonly _threads: number;
  private readonly _activeWorkers: Set<Worker> = new Set();
  private readonly _memoryStore: MemoryStore = new MemoryStore();
  private _isTerminated = false;

  private readonly _persistentManager: PersistentWorkerManager;
  private readonly _orchestrator: WorkerOrchestrator;
  public readonly logger: Logger;

  constructor(options: { workers: TConfigs; logLevel?: LogLevel }) {
    this._workers = options.workers as unknown as WorkerConfig[];
    this.logger = new Logger(options.logLevel ?? 'error');
    this._threads =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;

    const commonContext = {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
    };

    this._persistentManager = new PersistentWorkerManager(commonContext);
    this._orchestrator = new WorkerOrchestrator(commonContext);
  }

  get isTerminated(): boolean {
    return this._isTerminated;
  }

  private trackWorker(worker: Worker): Worker {
    if (this._isTerminated) {
      worker.terminate();
      throw new Error('MainWorkerFactory has been terminated');
    }
    this._activeWorkers.add(worker);
    return worker;
  }

  private terminateWorker(worker: Worker): void {
    this._activeWorkers.delete(worker);
    try {
      worker.terminate();
    } catch {
      // Ignore errors if worker is already terminated
    }
  }

  partitionArray<T>(array: T[], numChunks: number): T[][] {
    return partitionArray(array, numChunks);
  }

  private findWorkerByName(name: string): WorkerConfig | undefined {
    return this._workers.find((worker) => worker.name === name);
  }

  async runWorker<TName extends keyof WorkerConfigMap<TConfigs> & string>(
    workerName: TName,
    rawParams: {
      srcData?: WorkerDataParam<WorkerConfigMap<TConfigs>[TName]>;
      __memory_ref__?: string;
      deleteMemory?: boolean;
    } & Record<string, unknown>,
  ): Promise<
    TypedSettledResults<WorkerReturnType<WorkerConfigMap<TConfigs>[TName]>>
  > {
    return executeWorker(workerName, rawParams, {
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      memoryStore: this._memoryStore,
      threads: this._threads,
      orchestrator: this._orchestrator,
      logger: this.logger,
    });
  }

  async deleteMemory(ref: string): Promise<boolean> {
    return this._memoryStore.delete(ref);
  }

  async clearMemory(): Promise<void> {
    this._memoryStore.clear();
  }

  async getMemoryStats(): Promise<MemoryStats> {
    return this._memoryStore.stats();
  }

  async collectResults<
    T = unknown,
    R = T extends (infer Item)[] ? Item[] : T[],
  >(
    settled: TypedSettledResults<T> | TypedSettledResults<unknown>,
    options: CollectOptions<T, R> = {},
  ): Promise<CollectedResult<R>> {
    return collectWorkerResults(settled, options, {
      isTerminated: () => this.isTerminated,
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
    });
  }

  async pipeline<TResult = unknown>(steps: PipelineStep[]): Promise<TResult> {
    return executePipeline(steps, {
      memoryStore: this._memoryStore,
      isTerminated: () => this.isTerminated,
      findWorkerByName: this.findWorkerByName.bind(this),
      trackWorker: this.trackWorker.bind(this),
      terminateWorker: this.terminateWorker.bind(this),
      logger: this.logger,
    });
  }

  async runPersistent<TResult = unknown>(
    workerName: string,
    params: { dataset?: unknown; config: unknown },
  ): Promise<TResult> {
    return this._persistentManager.runPersistent(workerName, params);
  }

  release(workerName: string): void {
    this._persistentManager.release(workerName);
  }

  terminate(): void {
    this._isTerminated = true;
    this._persistentManager.terminateAll();
    for (const worker of Array.from(this._activeWorkers)) {
      this.terminateWorker(worker);
    }
    this._activeWorkers.clear();
    this._memoryStore.clear();
  }

  destroy(): void {
    this.terminate();
  }

  reset(): void {
    this.terminate();
    this._isTerminated = false;
  }

  restart(): void {
    this.reset();
  }
}

export default MainWorkerFactory;
