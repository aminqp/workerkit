import { WorkerConfig } from '../main-worker-factory/types';
import { MemoryStore } from '../memory-store';
import { MemoryWorkerProxy } from '../memory-store/memory-worker-proxy';
import { ILogger } from '../logger';

export interface PipelineContext {
  memoryStore: MemoryStore;
  memoryWorkerProxy: MemoryWorkerProxy;
  isTerminated: () => boolean;
  findWorkerByName: (name: string) => WorkerConfig | undefined;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
}
