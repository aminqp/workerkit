/**
 * Compile-time checks for the public types — verified by `tsc -p e2e`
 * (`pnpm typecheck`), never executed. Each `@ts-expect-error` fails the
 * type-check if the error it expects stops occurring.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
  type WorkerConfig,
} from '@offmain/workerkit';

function makeNumbers({ data }: { data: { count: number } }): number[] {
  return Array.from({ length: data.count }, (_, i) => i);
}

export async function memoryOnlyResultHasNoData() {
  const factory = new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'refOnly',
        role: 'compute',
        func: makeNumbers,
        memoryOnly: true,
      }),
      defineWorkerConfig({
        name: 'withData',
        role: 'compute',
        func: makeNumbers,
        memory: true,
      }),
    ),
  });

  const refOnly = await factory.runWorker('refOnly', {
    srcData: { count: 1 },
  });
  const ref: string | undefined = refOnly.__memory_ref__;
  // @ts-expect-error — a memoryOnly result never carries data
  const _neverData: number = refOnly.data.length;

  const withData = await factory.runWorker('withData', {
    srcData: { count: 1 },
  });
  const numbers: number[] = withData.data;
  return { ref, numbers };
}

/** The removed `dependencies` option is an unknown property of WorkerConfig. */
export const removedDependenciesOption: WorkerConfig = {
  name: 'withDependencies',
  role: 'compute',
  func: makeNumbers,
  // @ts-expect-error — `dependencies` was removed in 2.0
  dependencies: [],
};

/** Configs typed loosely as WorkerConfig[] still get a usable result type. */
export async function looselyTypedConfigs(workers: WorkerConfig[]) {
  const factory = new MainWorkerFactory({ workers });
  const result = await factory.runWorker('anything', { srcData: [1] });
  const count: number = result.succeeded;
  const data: unknown = result.data;
  return { count, data };
}
