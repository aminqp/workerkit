import { WorkerConfig } from '../main-worker-factory/types';
import { WorkerOrchestrator } from '../orchestrator';
import { MemoryStore } from '../memory-store';
import { MemoryWorkerProxy } from '../memory-store';
import { ILogger } from '../logger/types';

export interface RunWorkerContext {
  isTerminated: () => boolean;
  findWorkerByName: (name: string) => WorkerConfig | undefined;
  memoryStore: MemoryStore;
  memoryWorkerProxy: MemoryWorkerProxy;
  factoryToken: string;
  threads: number;
  orchestrator: WorkerOrchestrator;
  logger: ILogger;
}
