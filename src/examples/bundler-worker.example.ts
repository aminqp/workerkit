/**
 * Example demonstrating how to use `createWorker` with Webpack 5, Vite, Rollup, or Parcel.
 *
 * By passing `createWorker: () => new Worker(new URL('./bundler-luxon-i18n.worker.ts', import.meta.url), { type: 'module' })`
 * to `WorkerConfig` or `WorkerFactoryOptions`, the module bundler statically analyzes the worker call,
 * bundles the worker script along with all its dependencies (e.g. Luxon, date-fns, i18next), and allows
 * workerkit to manage worker thread creation and concurrency.
 */
import { MainWorkerFactory } from '../tools';
import WorkerFactory from '../tools/worker-factory/worker-factory';

export async function runBundlerWorkerExample() {
  // Option 1: Using MainWorkerFactory with createWorker
  const factory = new MainWorkerFactory({
    workers: [
      {
        name: 'luxonTransform',
        role: 'transform',
        // In Webpack 5 / Vite / ES modules, the bundler statically analyzes new Worker(new URL(..., import.meta.url))
        createWorker: () =>
          new Worker(
            new URL('./bundler-luxon-i18n.worker.ts', import.meta.url),
            {
              type: 'module',
            },
          ),
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

  // Option 2: Using low-level WorkerFactory directly with createWorker
  const directFactory = new WorkerFactory(undefined, {
    createWorker: () =>
      new Worker(new URL('./bundler-luxon-i18n.worker.ts', import.meta.url), {
        type: 'module',
      }),
  });

  return { data, directWorker: directFactory.getWorker };
}
