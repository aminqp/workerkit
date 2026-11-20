/**
 * Finding #6 — `memoryOnly` must return only the ref, `memory` must return
 * the data and a ref that holds the same data, and refs must be consumable by
 * the next worker (runWorker and pipeline, single and multi step).
 *
 * Real-world shape: a producer generates a large dataset that only a second
 * worker needs; the UI only ever sees the ref.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, summarize } from '../helpers';

function makeNumbers({ data }: { data: { count: number } }): number[] {
  return Array.from({ length: data.count }, (_, i) => i);
}

function sumAll({ data }: { data: number[] }): number {
  return data.reduce((acc, n) => acc + n, 0);
}

function passThrough({ data }: { data: unknown }): unknown {
  return data;
}

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'produceRefOnly',
        role: 'compute',
        func: makeNumbers,
        maxConcurrency: 1,
        memoryOnly: true,
      }),
      defineWorkerConfig({
        name: 'produceWithData',
        role: 'compute',
        func: makeNumbers,
        maxConcurrency: 1,
        memory: true,
      }),
      defineWorkerConfig({
        name: 'sumAll',
        role: 'compute',
        func: sumAll,
        maxConcurrency: 1,
      }),
      defineWorkerConfig({
        name: 'passThrough',
        role: 'compute',
        func: passThrough,
      }),
    ),
  });
}

const COUNT = 1000;
const EXPECTED_SUM = (COUNT * (COUNT - 1)) / 2;

export async function memoryOnlyReturnsOnlyRef() {
  const factory = createFactory();
  const produced = summarize(
    await factory.runWorker('produceRefOnly', { srcData: { count: COUNT } }),
  );
  const statsAfterProduce = (await factory.getMemoryStats()).count;
  const consumed = await settle(
    factory
      .runWorker('sumAll', {
        __memory_ref__: produced.ref ?? undefined,
        deleteMemory: true,
      })
      .then(summarize),
  );
  const statsAfterConsume = (await factory.getMemoryStats()).count;
  factory.terminate();
  return {
    produced,
    statsAfterProduce,
    consumed,
    statsAfterConsume,
    expectedSum: EXPECTED_SUM,
  };
}

export async function memoryReturnsDataAndRef() {
  const factory = createFactory();
  const produced = summarize(
    await factory.runWorker('produceWithData', { srcData: { count: COUNT } }),
  );
  const consumed = await settle(
    factory
      .runWorker('sumAll', { __memory_ref__: produced.ref ?? undefined })
      .then(summarize),
  );
  factory.terminate();
  return {
    dataLength: Array.isArray(produced.data) ? produced.data.length : null,
    hasRef: produced.ref !== null,
    consumed,
    expectedSum: EXPECTED_SUM,
  };
}

export async function pipelineConsumesRef(steps: 1 | 2) {
  const factory = createFactory();
  const { __memory_ref__: ref } = await factory.runWorker('produceRefOnly', {
    srcData: { count: COUNT },
  });
  const pipelineSteps =
    steps === 1
      ? [{ worker: 'sumAll' as const, __memory_ref__: ref }]
      : [
          { worker: 'passThrough' as const, __memory_ref__: ref },
          { worker: 'sumAll' as const },
        ];
  const outcome = await settle(factory.pipeline(pipelineSteps).then(summarize));
  factory.terminate();
  return { outcome, expectedSum: EXPECTED_SUM };
}
