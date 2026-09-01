import { ILogger } from '../logger';

export interface CollectResultsContext {
  isTerminated: () => boolean;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
}
