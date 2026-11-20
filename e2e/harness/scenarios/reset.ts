/**
 * Finding #1 — `reset()` / `restart()` must leave the factory fully usable.
 *
 * Real-world shape: a single-page app keeps one factory for its lifetime and
 * resets it on logout (or when switching workspaces); the next job must run.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, summarize } from '../helpers';

function double({ data }: { data: number[] }): number[] {
  return data.map((n) => n * 2);
}

function addOne({ data }: { data: number[] }): number[] {
  return data.map((n) => n + 1);
}

function scale({
  data,
  config,
}: {
  data: number[];
  config: { mult: number };
}): number[] {
  return data.map((n) => n * config.mult);
}

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'double',
        role: 'compute',
        func: double,
        partition: true,
        maxConcurrency: 2,
      }),
      defineWorkerConfig({
        name: 'doubleStored',
        role: 'compute',
        func: double,
        maxConcurrency: 1,
        memory: true,
      }),
      defineWorkerConfig({ name: 'addOne', role: 'compute', func: addOne }),
      defineWorkerConfig({ name: 'scale', role: 'compute', func: scale }),
    ),
  });
}

export async function runWorkerAfterReset(method: 'reset' | 'restart') {
  const factory = createFactory();
  const before = await settle(
    factory.runWorker('double', { srcData: [1, 2, 3, 4] }).then(summarize),
  );
  factory[method]();
  const after = await settle(
    factory.runWorker('double', { srcData: [5, 6] }).then(summarize),
  );
  factory.terminate();
  return { before, after };
}

export async function memoryApisAfterReset() {
  const factory = createFactory();
  await factory.runWorker('doubleStored', { srcData: [1] });
  factory.reset();
  const statsAfterReset = await settle(factory.getMemoryStats());
  const clear = await settle(factory.clearMemory());
  const stored = await settle(
    factory.runWorker('doubleStored', { srcData: [7] }).then(summarize),
  );
  const statsAfterRun = await settle(factory.getMemoryStats());
  factory.terminate();
  return { statsAfterReset, clear, stored, statsAfterRun };
}

export async function pipelineAndPersistentAfterReset() {
  const factory = createFactory();
  await factory.pipeline([
    { worker: 'double', srcData: [1] },
    { worker: 'addOne' },
  ]);
  await factory.runPersistent('scale', { dataset: [1], config: { mult: 2 } });
  factory.reset();
  const pipeline = await settle(
    factory
      .pipeline([{ worker: 'double', srcData: [1, 2] }, { worker: 'addOne' }])
      .then(summarize),
  );
  const persistent = await settle(
    factory.runPersistent('scale', { dataset: [3], config: { mult: 3 } }),
  );
  factory.terminate();
  return { pipeline, persistent };
}
