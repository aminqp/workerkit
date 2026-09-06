import { WorkerConfig, WorkerFunction } from '../main-worker-factory/types';

/**
 * Helper to strictly type a single WorkerConfig.
 * Especially useful for `createWorker` configs where the function type is not natively inferrable.
 *
 * @example
 * defineWorkerConfig<typeof myFunc>({ name: 'myWorker', createWorker: () => new Worker(...) })
 */
export function defineWorkerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TFunc extends WorkerFunction<any, any>,
>(): <const TConfig extends WorkerConfig<TFunc>>(
  config: TConfig,
) => TConfig & { _typeHint: TFunc };

export function defineWorkerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TConfig extends WorkerConfig<any>,
>(config: TConfig): TConfig;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineWorkerConfig(config?: any): any {
  if (config === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (cfg: any) => cfg;
  }
  return config;
}

/**
 * Helper to strictly type an array of WorkerConfigs.
 * Eliminates the need for `as const` while preserving the exact generics of each worker.
 *
 * @example
 * const workers = defineWorkerConfigs(
 *   defineWorkerConfig({ name: 'a', func: funcA }),
 *   defineWorkerConfig<typeof b>()({ name: 'b', createWorker: () => new Worker(...) })
 * );
 */
export function defineWorkerConfigs<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends readonly WorkerConfig<any>[],
>(...workers: T): T {
  return workers;
}
