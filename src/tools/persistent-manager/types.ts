import { WorkerConfig } from '../main-worker-factory/types';
import { ILogger } from '../logger';

export interface PersistentManagerContext {
  isTerminated: () => boolean;
  findWorkerByName: (name: string) => WorkerConfig | undefined;
  trackWorker: (worker: Worker) => Worker;
  logger: ILogger;
  terminateWorker: (worker: Worker) => void;
  /** The factory's current run signal (replaced on `reset()`). */
  readonly signal: AbortSignal;
}
