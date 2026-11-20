/**
 * Finding #5 — what `runWorker` returns with and without `partition`, and
 * whether the README Quick Start prints what it says it prints.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { summarize } from '../helpers';

function sum({ data }: { data: number[] }): number {
  return data.reduce((acc, n) => acc + n, 0);
}

function identity({ data }: { data: number[] }): number[] {
  return data;
}

/** The README Quick Start exactly as published in v1.0.0. */
export async function quickStartAsPublished() {
  const factory = new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'sum',
        role: 'computation',
        func: sum,
        maxConcurrency: 4,
        retries: 2,
      }),
    ),
  });
  const { data, succeeded } = await factory.runWorker('sum', {
    srcData: [1, 2, 3, 4, 5],
  });
  factory.terminate();
  return { data, succeeded };
}

/** The corrected README Quick Start (keep in sync with README.md). */
export async function quickStartCorrected() {
  const factory = new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'sum',
        role: 'computation',
        func: sum,
        partition: true,
        maxConcurrency: 4,
        retries: 2,
      }),
    ),
  });
  const { data, succeeded } = await factory.runWorker('sum', {
    srcData: [1, 2, 3, 4, 5],
    reducer: (partialSums) => partialSums.reduce((acc, n) => acc + n, 0),
  });
  factory.terminate();
  return { data, succeeded };
}

function identityFactory(partition: boolean, maxConcurrency: number) {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'identity',
        role: 'compute',
        func: identity,
        partition,
        maxConcurrency,
      }),
    ),
  });
}

export async function partitionedNoDuplicates() {
  const input = Array.from({ length: 1000 }, (_, i) => i);
  const factory = identityFactory(true, 4);
  const result = summarize(
    await factory.runWorker('identity', { srcData: input }),
  );
  factory.terminate();
  return {
    matchesInput: JSON.stringify(result.data) === JSON.stringify(input),
    succeeded: result.succeeded,
  };
}

export async function fewerItemsThanThreads() {
  const factory = identityFactory(true, 8);
  const result = summarize(
    await factory.runWorker('identity', { srcData: [1, 2] }),
  );
  factory.terminate();
  return result;
}

export async function unpartitionedReplicates() {
  const factory = identityFactory(false, 3);
  const result = summarize(
    await factory.runWorker('identity', { srcData: [1, 2] }),
  );
  factory.terminate();
  return result;
}
