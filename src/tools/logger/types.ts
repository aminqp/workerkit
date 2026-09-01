export type LogLevel = 'verbose' | 'info' | 'error' | 'silent';

export interface ILogger {
  verbose(...args: unknown[]): void;
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
