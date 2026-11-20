import { ILogger } from '../logger';
import { MemoryWorkerProxy } from '../memory-store';

export interface CollectResultsContext {
  isTerminated: () => boolean;
  trackWorker: (worker: Worker) => Worker;
  terminateWorker: (worker: Worker) => void;
  logger: ILogger;
  memoryWorkerProxy: MemoryWorkerProxy;
  factoryToken: string;
  /** Signal of the factory run this collection belongs to. */
  signal: AbortSignal;
}

/**
 * Where the merged result goes:
 * - `none`     — return it (default)
 * - `withData` — store it in the MemoryWorker and also return it (`memory: true`)
 * - `refOnly`  — store it in the MemoryWorker and return only the ref (`memoryOnly: true`)
 */
export type CollectStoreMode = 'none' | 'withData' | 'refOnly';
