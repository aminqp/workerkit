import { WorkerFactory } from '../worker-factory';

export type WorkerName = string;
export type WorkerRole = string;
export type WorkerFunction = (...params: any[]) => void;

export interface WorkerConfig {
  name: WorkerName;
  role: WorkerRole;
  func: WorkerFunction;
  maxConcurrency?: number
};

export interface MainWorkerFactoryOptions {
  workers: WorkerConfig[];
}

export interface MainWorkerFactoryWorker extends WorkerConfig {
  worker: WorkerFactory;
}
