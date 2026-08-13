/**
 * Example demonstrating how to use `createWorker` to supply custom Web Worker factory initializers
 * to `MainWorkerFactory` or low-level `WorkerFactory`.
 *
 * `createWorker: () => new Worker(new URL(...))` is ideal for Webpack 5, Vite, Rollup, and Parcel
 * because bundlers statically analyze the `new Worker(new URL(...))` expression in consumer source code,
 * bundling the worker as an individual JS chunk while allowing workerkit to scale `maxConcurrency`.
 */
import { MainWorkerFactory } from '../tools';
import WorkerFactory from '../tools/worker-factory/worker-factory';

export async function runWorkerInstanceExample() {
  const workerScript = `
    self.addEventListener('message', (event) => {
      const { data } = event.data;
      self.postMessage({ ok: true, data: data * 2 });
    });
  `;
  const blob = new Blob([workerScript], { type: 'application/javascript' });

  // Registering with createWorker factory function
  const factory = new MainWorkerFactory({
    workers: [
      {
        name: 'webpackBundledWorker',
        role: 'computation',
        createWorker: () => new Worker(URL.createObjectURL(blob)),
        maxConcurrency: 4,
      },
    ] as const,
  });

  const settled = await factory.runWorker('webpackBundledWorker', {
    srcData: 21,
  });
  const { data } = await factory.collectResults(settled);

  // Low-level WorkerFactory directly with createWorker option
  const directFactory = new WorkerFactory(undefined, {
    createWorker: () => new Worker(URL.createObjectURL(blob)),
  });

  return { data, directWorker: directFactory.getWorker };
}
