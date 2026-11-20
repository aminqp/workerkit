/**
 * Finding #2 — calls that are still running when `terminate()` is called must
 * settle (reject) instead of hanging, the merge worker must be stopped too,
 * and a call cancelled by `reset()` must not keep retrying in the new run.
 *
 * Real-world shape: a component starts a job, then unmounts (and terminates
 * its factory) before the job finishes.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { listen, settle, sleep, summarize } from '../helpers';

async function slowEcho({
  data,
}: {
  data: { ms: number; value: number };
}): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, data.ms));
  return data.value;
}

async function slowStep({ data }: { data: unknown }): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return data;
}

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

async function failSlowly({
  data,
}: {
  data: { channel: string; ms: number };
}): Promise<never> {
  const channel = new BroadcastChannel(data.channel);
  channel.postMessage('attempt');
  await new Promise((resolve) => setTimeout(resolve, data.ms));
  throw new Error('always fails');
}

function identity({ data }: { data: number[] }): number[] {
  return data;
}

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'slowEcho',
        role: 'compute',
        func: slowEcho,
        maxConcurrency: 1,
        retries: 0,
      }),
      defineWorkerConfig({ name: 'slowStep', role: 'compute', func: slowStep }),
      defineWorkerConfig({
        name: 'slowScale',
        role: 'compute',
        func: slowScale,
      }),
      defineWorkerConfig({
        name: 'failSlowly',
        role: 'compute',
        func: failSlowly,
        maxConcurrency: 1,
        retries: 5,
      }),
      defineWorkerConfig({
        name: 'identity',
        role: 'compute',
        func: identity,
        partition: true,
        maxConcurrency: 2,
      }),
    ),
  });
}

type Factory = ReturnType<typeof createFactory>;

/** Starts `start(factory)`, terminates after `delayMs`, reports how the call ended. */
async function terminateWhileRunning(
  start: (factory: Factory) => Promise<unknown>,
  delayMs = 300,
) {
  const factory = createFactory();
  const pending = settle(start(factory), 4000);
  await sleep(delayMs);
  const terminatedAt = performance.now();
  factory.terminate();
  const outcome = await pending;
  return {
    outcome,
    msAfterTerminate: Math.round(performance.now() - terminatedAt),
  };
}

export function runWorkerInFlight() {
  return terminateWhileRunning((factory) =>
    factory
      .runWorker('slowEcho', { srcData: { ms: 1500, value: 1 } })
      .then(summarize),
  );
}

export function pipelineInFlight() {
  return terminateWhileRunning((factory) =>
    factory
      .pipeline([{ worker: 'slowStep', srcData: [1] }, { worker: 'slowStep' }])
      .then(summarize),
  );
}

export function singleStepPipelineInFlight() {
  return terminateWhileRunning((factory) =>
    factory.pipeline([{ worker: 'slowStep', srcData: [1] }]).then(summarize),
  );
}

export function persistentInFlight() {
  return terminateWhileRunning((factory) =>
    factory.runPersistent('slowScale', {
      dataset: [1, 2],
      config: { mult: 2, delay: 1500 },
    }),
  );
}

/** Terminates while the merge (reducer) worker is busy. */
export function reducerInFlight() {
  return terminateWhileRunning(
    (factory) =>
      factory
        .runWorker('identity', {
          srcData: [1, 2, 3, 4],
          reducer: (shards: number[][]) => {
            const end = Date.now() + 1500;
            while (Date.now() < end) {
              // busy merge
            }
            return shards.flat();
          },
        })
        .then(summarize),
    600,
  );
}

/** A retrying call cancelled by reset() must not retry in the new run. */
export async function retryingCallThenReset() {
  const factory = createFactory();
  const channel = `attempts-${crypto.randomUUID()}`;
  const attempts = listen(channel);
  const pending = settle(
    factory
      .runWorker('failSlowly', { srcData: { channel, ms: 400 } })
      .then(summarize),
    4000,
  );
  await sleep(250);
  const resetAt = performance.now();
  factory.reset();
  const outcome = await pending;
  await sleep(1500);
  attempts.close();
  const healthy = await settle(
    factory.runWorker('identity', { srcData: [1, 2] }).then(summarize),
  );
  factory.terminate();
  return {
    outcome,
    attemptsBeforeReset: attempts.arrivals.filter((t) => t <= resetAt).length,
    attemptsAfterReset: attempts.arrivals.filter((t) => t > resetAt).length,
    healthy,
  };
}
