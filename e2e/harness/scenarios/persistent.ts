/**
 * Finding #3 — overlapping `runPersistent` calls must each get their own
 * result, `release()` must not strand pending calls, and a worker that fails
 * to start must not make later calls hang.
 *
 * Real-world shape: a settings panel whose slider calls `runPersistent` on
 * every input event against one cached dataset.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, sleep } from '../helpers';

async function slowScale({
  data,
  config,
}: {
  data: number[];
  config: { mult: number; delay: number };
}): Promise<number[]> {
  await new Promise((resolve) => setTimeout(resolve, config.delay));
  return data.map((n) => n * config.mult);
}

function crashy({
  data,
  config,
}: {
  data: number[];
  config: { mult: number; crash?: boolean };
}): number[] | Promise<number[]> {
  if (config.crash) {
    setTimeout(() => {
      throw new Error('uncaught crash inside worker');
    }, 0);
    return new Promise<number[]>(() => {});
  }
  return data.map((n) => n * config.mult);
}

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'slowScale',
        role: 'compute',
        func: slowScale,
      }),
      defineWorkerConfig({ name: 'crashy', role: 'compute', func: crashy }),
      defineWorkerConfig<(p: { data: number[] }) => number[]>()({
        name: 'broken',
        role: 'compute',
        createWorker: () =>
          new Worker(new URL('../workers/broken.worker.ts', import.meta.url), {
            type: 'module',
          }),
      }),
    ),
  });
}

const DATASET = [1, 2, 3];

async function seeded() {
  const factory = createFactory();
  await factory.runPersistent('slowScale', {
    dataset: DATASET,
    config: { mult: 1, delay: 0 },
  });
  return factory;
}

export async function overlappingCalls(order: 'slowFirst' | 'fastFirst') {
  const factory = await seeded();
  const [delayA, delayB] = order === 'slowFirst' ? [300, 20] : [20, 300];
  const a = settle(
    factory.runPersistent('slowScale', { config: { mult: 2, delay: delayA } }),
    3000,
  );
  const b = settle(
    factory.runPersistent('slowScale', { config: { mult: 3, delay: delayB } }),
    3000,
  );
  const result = { a: await a, b: await b };
  factory.terminate();
  return result;
}

/** Eight rapid calls, later ones finishing first — like dragging a slider. */
export async function sliderBurst() {
  const factory = await seeded();
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      settle(
        factory.runPersistent('slowScale', {
          config: { mult: i + 1, delay: (8 - i) * 30 },
        }),
        3000,
      ),
    ),
  );
  factory.terminate();
  return outcomes;
}

export async function releaseWhilePending() {
  const factory = await seeded();
  const pending = settle(
    factory.runPersistent('slowScale', { config: { mult: 2, delay: 800 } }),
    3000,
  );
  await sleep(100);
  factory.release('slowScale');
  const outcome = await pending;
  const withoutDataset = await settle(
    factory.runPersistent('slowScale', { config: { mult: 2, delay: 0 } }),
  );
  const withDataset = await settle(
    factory.runPersistent('slowScale', {
      dataset: [4],
      config: { mult: 2, delay: 0 },
    }),
  );
  factory.terminate();
  return { outcome, withoutDataset, withDataset };
}

/** An uncaught error after the worker has been working keeps its cache. */
export async function crashAfterSuccess() {
  const factory = createFactory();
  const seed = await settle(
    factory.runPersistent('crashy', { dataset: [1, 2], config: { mult: 1 } }),
  );
  const crashed = await settle(
    factory.runPersistent('crashy', { config: { mult: 1, crash: true } }),
    3000,
  );
  const afterCrash = await settle(
    factory.runPersistent('crashy', { config: { mult: 2 } }),
    3000,
  );
  factory.terminate();
  return { seed, crashed, afterCrash };
}

function viewOf({
  data,
  config,
}: {
  data: Float64Array;
  config: { from: number };
}): Float64Array {
  return data.subarray(config.from);
}

/**
 * Returning (a view of) the cached typed array must not detach the cache:
 * the result is transferred to the page, so it must not share a buffer with
 * the dataset the worker keeps for later calls.
 */
export async function typedArrayCacheSurvives() {
  const factory = new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({ name: 'viewOf', role: 'compute', func: viewOf }),
    ),
  });
  const toArray = (p: Promise<Float64Array>) => p.then((a) => Array.from(a));
  const first = await settle(
    toArray(
      factory.runPersistent('viewOf', {
        dataset: new Float64Array([1, 2, 3, 4]),
        config: { from: 0 },
      }),
    ),
  );
  const second = await settle(
    toArray(factory.runPersistent('viewOf', { config: { from: 2 } })),
  );
  factory.terminate();
  return { first, second };
}

/** A worker that fails while loading must fail every call, not hang. */
export async function brokenWorker() {
  const factory = createFactory();
  const first = await settle(
    factory.runPersistent('broken', { dataset: [1], config: {} }),
    3000,
  );
  const second = await settle(
    factory.runPersistent('broken', { dataset: [1], config: {} }),
    3000,
  );
  factory.terminate();
  return { first, second };
}
