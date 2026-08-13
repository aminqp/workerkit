/**
 * Example demonstrating how to use `workerURL` with Webpack 5, Vite, Rollup, or Parcel.
 *
 * By passing `workerURL: new URL('./bundler-luxon-i18n.worker.ts', import.meta.url)` to `WorkerConfig`
 * or `WorkerFactoryOptions`, the module bundler automatically bundles the worker script
 * along with all its external package dependencies (e.g. Luxon, date-fns, i18next).
 */
import { MainWorkerFactory } from '../tools';
import WorkerFactory from '../tools/worker-factory/worker-factory';

export async function runBundlerWorkerExample() {
  // Option 1: Using MainWorkerFactory with workerURL
  const factory = new MainWorkerFactory({
    workers: [
      {
        name: 'luxonTransform',
        role: 'transform',
        // In Webpack 5 / Vite / ES modules, the bundler statically analyzes new URL(..., import.meta.url)
        workerURL: new URL('./bundler-luxon-i18n.worker.ts', import.meta.url),
        maxConcurrency: 2,
      },
    ] as const,
  });

  const settled = await factory.runWorker('luxonTransform', {
    srcData: {
      locale: 'es',
      items: [
        { id: 'tx-101', date: '2026-08-01T10:00:00Z', value: 1250.509 },
        { id: 'tx-102', date: '2026-08-10T14:30:00Z', value: 89.99 },
      ],
    },
  });

  const { data } = await factory.collectResults(settled);

  // Option 2: Using low-level WorkerFactory directly with workerURL
  const directFactory = new WorkerFactory(undefined, {
    workerURL: new URL('./bundler-luxon-i18n.worker.ts', import.meta.url),
  });

  return { data, directWorker: directFactory.getWorker };
}
