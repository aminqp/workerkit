/**
 * Suspected finding #9 — worker functions written as arrow functions. The
 * Default template (used by single-step `pipeline()` calls) builds
 * `await ${func}(event.data)`, which does not call an arrow function.
 *
 * Real-world shape: `export const transform = ({ data }) => ...` is at least
 * as common as `export function transform(...)`.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, summarize } from '../helpers';

const doubleExpression = ({ data }: { data: number[] }) =>
  data.map((n) => n * 2);

const doubleBlock = ({ data }: { data: number[] }) => {
  return data.map((n) => n * 2);
};

const doubleAsync = async ({ data }: { data: number[] }) =>
  data.map((n) => n * 2);

const FUNCS = {
  expression: doubleExpression,
  block: doubleBlock,
  async: doubleAsync,
} as const;

type Kind = keyof typeof FUNCS;

function createFactory(kind: Kind) {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'double',
        role: 'compute',
        func: FUNCS[kind],
        maxConcurrency: 1,
      }),
      defineWorkerConfig({
        name: 'scale',
        role: 'compute',
        func: ({
          data,
          config,
        }: {
          data: number[];
          config: { mult: number };
        }) => data.map((n) => n * config.mult),
      }),
    ),
  });
}

export async function allModes(kind: Kind) {
  const factory = createFactory(kind);
  const runWorker = await settle(
    factory.runWorker('double', { srcData: [1, 2, 3] }).then(summarize),
  );
  const singleStepPipeline = await settle(
    factory
      .pipeline([{ worker: 'double', srcData: [1, 2, 3] }])
      .then(summarize),
  );
  const twoStepPipeline = await settle(
    factory
      .pipeline([
        { worker: 'double', srcData: [1, 2, 3] },
        { worker: 'double' },
      ])
      .then(summarize),
  );
  const persistent = await settle(
    factory.runPersistent('scale', { dataset: [1, 2, 3], config: { mult: 2 } }),
  );
  factory.terminate();
  return { runWorker, singleStepPipeline, twoStepPipeline, persistent };
}
