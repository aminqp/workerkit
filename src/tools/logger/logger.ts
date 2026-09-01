import { LogLevel, ILogger } from './types';

/**
 * A lightweight logging utility designed for the Web Worker Manager.
 *
 * Supports various log levels to control the verbosity of the output:
 * - `verbose`: Outputs debug, info, and error messages.
 * - `info`: Outputs info and error messages (suppresses debug).
 * - `error`: Outputs only error messages (suppresses debug and info).
 * - `silent`: Suppresses all messages.
 *
 * All log messages are automatically prefixed with `[WorkerManager]` to
 * distinguish them easily in the console.
 */
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
