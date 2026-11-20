import { WorkerConfig } from '../main-worker-factory/types';
import { MemoryStore } from '../memory-store';
import { MemoryWorkerProxy } from '../memory-store/memory-worker-proxy';
import { ILogger } from '../logger';

export interface PipelineContext {
  memoryStore: MemoryStore;
  memoryWorkerProxy: MemoryWorkerProxy;
  /** Authenticates a step's requests to the MemoryWorker. */
  factoryToken: string;
  isTerminated: () => boolean;
  findWorkerByName: (name: string) => WorkerConfig | undefined;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
  /** Signal of the factory run this pipeline belongs to. */
  signal: AbortSignal;
}
