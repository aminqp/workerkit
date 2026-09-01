import { ILogger } from '../logger';

export interface OrchestratorContext {
  isTerminated: () => boolean;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
}
