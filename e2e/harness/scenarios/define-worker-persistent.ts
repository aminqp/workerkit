/**
 * Finding #4 — bundled workers written with `defineWorker` must support
 * `runPersistent` (dataset caching), and ordinary calls must not be mistaken
 * for persistent requests.
 *
 * Real-world shape: a worker that imports npm packages is bundled with
 * `createWorker`, and the app re-runs it with different configs.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import type { ScaleParams } from '../workers/persistent-scale.worker';
import type { EchoParams } from '../workers/echo-params.worker';
import { settle, sleep, summarize } from '../helpers';

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig<(p: ScaleParams) => Promise<number[]>>()({
        name: 'scaleBundled',
        role: 'compute',
        createWorker: () =>
          new Worker(
            new URL('../workers/persistent-scale.worker.ts', import.meta.url),
            { type: 'module' },
          ),
      }),
      defineWorkerConfig<(p: EchoParams) => EchoParams>()({
        name: 'echoBundled',
        role: 'compute',
        maxConcurrency: 1,
        createWorker: () =>
          new Worker(
            new URL('../workers/echo-params.worker.ts', import.meta.url),
            { type: 'module' },
          ),
      }),
    ),
  });
}

export async function cachesDataset() {
  const factory = createFactory();
  const first = await settle(
    factory.runPersistent('scaleBundled', {
      dataset: [1, 2, 3],
      config: { mult: 2 },
    }),
  );
  const second = await settle(
    factory.runPersistent('scaleBundled', { config: { mult: 10 } }),
  );
  const replaced = await settle(
    factory.runPersistent('scaleBundled', {
      dataset: [5],
      config: { mult: 3 },
    }),
  );
  const afterReplace = await settle(
    factory.runPersistent('scaleBundled', { config: { mult: 2 } }),
  );
  factory.terminate();
  return { first, second, replaced, afterReplace };
}

export async function requiresDatasetFirst() {
  const factory = createFactory();
  const outcome = await settle(
    factory.runPersistent('scaleBundled', { config: { mult: 2 } }),
  );
  factory.terminate();
  return outcome;
}

export async function overlappingCalls() {
  const factory = createFactory();
  await factory.runPersistent('scaleBundled', {
    dataset: [1, 2, 3],
    config: { mult: 1 },
  });
  const a = settle(
    factory.runPersistent('scaleBundled', { config: { mult: 2, delay: 300 } }),
    3000,
  );
  const b = settle(
    factory.runPersistent('scaleBundled', { config: { mult: 3, delay: 20 } }),
    3000,
  );
  const result = { a: await a, b: await b };
  factory.terminate();
  return result;
}

export async function releaseAndRecreate() {
  const factory = createFactory();
  await factory.runPersistent('scaleBundled', {
    dataset: [1, 2],
    config: { mult: 1 },
  });
  factory.release('scaleBundled');
  await sleep(50);
  const withoutDataset = await settle(
    factory.runPersistent('scaleBundled', { config: { mult: 2 } }),
  );
  const withDataset = await settle(
    factory.runPersistent('scaleBundled', {
      dataset: [7],
      config: { mult: 2 },
    }),
  );
  factory.terminate();
  return { withoutDataset, withDataset };
}

/** A normal runWorker call that happens to pass `type: 'run'` and `config`. */
export async function regularRunUnaffected() {
  const factory = createFactory();
  const outcome = await settle(
    factory
      .runWorker('echoBundled', {
        srcData: { x: 1 },
        type: 'run',
        config: { y: 2 },
      })
      .then(summarize),
  );
  factory.terminate();
  return outcome;
}
