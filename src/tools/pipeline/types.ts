import { WorkerConfig } from '../main-worker-factory/types';
import { MemoryStore } from '../memory-store';
import { ILogger } from '../logger';

export interface PipelineContext {
  memoryStore: MemoryStore;
  isTerminated: () => boolean;
  findWorkerByName: (name: string) => WorkerConfig | undefined;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
}
