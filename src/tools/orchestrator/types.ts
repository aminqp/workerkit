import { ILogger } from '../logger';
import { MemoryWorkerProxy } from '../memory-store';

export interface OrchestratorContext {
  isTerminated: () => boolean;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
  /** The factory's current MemoryWorker proxy (replaced on `reset()`). */
  readonly memoryWorkerProxy: MemoryWorkerProxy;
  /** The factory's current run signal (replaced on `reset()`). */
  readonly signal: AbortSignal;
  factoryToken: string;
}
