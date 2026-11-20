/**
 * Finding #7 — how many times a failing worker actually runs, so the
 * documented `retries` default can be checked against real behaviour.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { listen, sleep, summarize } from '../helpers';

function alwaysFails({ data }: { data: { channel: string } }): never {
  new BroadcastChannel(data.channel).postMessage('attempt');
  throw new Error('always fails');
}

export async function countAttempts(retries: number | null) {
  const factory = new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'alwaysFails',
        role: 'compute',
        func: alwaysFails,
        maxConcurrency: 1,
        ...(retries === null ? {} : { retries }),
      }),
    ),
  });
  const channel = `attempts-${crypto.randomUUID()}`;
  const attempts = listen(channel);
  const result = summarize(
    await factory.runWorker('alwaysFails', { srcData: { channel } }),
  );
  await sleep(200);
  attempts.close();
  factory.terminate();
  return { attempts: attempts.arrivals.length, result };
}
