/**
 * Regression check — replies from hand-written workers (bundled workers that
 * do not use `defineWorker`). v1.0.0 returned the `data` field of the reply
 * from a pipeline's last step and from a persistent call whether or not the
 * reply had `ok`, so a worker replying `{ data }` must keep working.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, summarize } from '../helpers';

type Reply = 'ok' | 'wrapped' | 'raw';

function createPipelineFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'double',
        role: 'compute',
        func: ({ data }: { data: number[] }) => data.map((n) => n * 2),
      }),
      defineWorkerConfig<(p: { data: number[]; reply: Reply }) => number[]>()({
        name: 'handwritten',
        role: 'compute',
        createWorker: () =>
          new Worker(
            new URL('../workers/handwritten-step.worker.ts', import.meta.url),
            { type: 'module' },
          ),
      }),
    ),
  });
}

/** `[1, 2, 3]` through the hand-written step alone → `[2, 3, 4]`. */
export async function pipelineSingleStep(reply: Reply) {
  const factory = createPipelineFactory();
  const result = await settle(
    factory
      .pipeline([{ worker: 'handwritten', srcData: [1, 2, 3], reply }])
      .then(summarize),
  );
  factory.terminate();
  return result;
}

/** `[1, 2, 3]` doubled, then through the hand-written step → `[3, 5, 7]`. */
export async function pipelineLastStep(reply: Reply) {
  const factory = createPipelineFactory();
  const result = await settle(
    factory
      .pipeline([
        { worker: 'double', srcData: [1, 2, 3] },
        { worker: 'handwritten', reply },
      ])
      .then(summarize),
  );
  factory.terminate();
  return result;
}

/**
 * A hand-written persistent worker written against the v1.0.0 protocol:
 * caches `[1, 2, 3]`, then scales it by 2 (with the dataset) and by 3 (from
 * the cache) → `[2, 4, 6]` and `[3, 6, 9]`.
 */
export async function persistent(reply: Exclude<Reply, 'ok'>) {
  const factory = new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig<
        (p: {
          data: number[];
          config: { mult: number; reply: Exclude<Reply, 'ok'> };
        }) => number[]
      >()({
        name: 'scale',
        role: 'compute',
        createWorker: () =>
          new Worker(
            new URL(
              '../workers/handwritten-persistent.worker.ts',
              import.meta.url,
            ),
            { type: 'module' },
          ),
      }),
    ),
  });
  const withDataset = await settle(
    factory.runPersistent('scale', {
      dataset: [1, 2, 3],
      config: { mult: 2, reply },
    }),
  );
  const fromCache = await settle(
    factory.runPersistent('scale', { config: { mult: 3, reply } }),
  );
  factory.terminate();
  return { withDataset, fromCache };
}
