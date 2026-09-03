import { ILogger } from '../logger';
import { MemoryWorkerProxy } from '../memory-store';

export interface CollectResultsContext {
  isTerminated: () => boolean;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
  memoryWorkerProxy: MemoryWorkerProxy;
  factoryToken: string;
}
