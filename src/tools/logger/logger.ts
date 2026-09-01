import { LogLevel, ILogger } from './types';

export class Logger implements ILogger {
  private level: LogLevel;

  constructor(level: LogLevel = 'error') {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  verbose(...args: unknown[]) {
    if (this.level === 'verbose') {
      console.debug('[WorkerManager]', ...args);
    }
  }

  info(...args: unknown[]) {
    if (this.level === 'verbose' || this.level === 'info') {
      console.info('[WorkerManager]', ...args);
    }
  }

  error(...args: unknown[]) {
    if (this.level !== 'silent') {
      console.error('[WorkerManager]', ...args);
    }
  }
}
