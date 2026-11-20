/**
 * Finding #14 — payloads and results holding several views of one buffer.
 *
 * A transfer list that names the same ArrayBuffer twice makes `postMessage`
 * throw a DataCloneError, so every message carrying (for example) the two
 * halves of one typed array failed to send.
 *
 * Real-world shape: splitting a Float32Array of samples into channels with
 * `subarray()` and sending both channels to a worker.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, summarize } from '../helpers';

interface Channels {
  left: Float64Array;
  right: Float64Array;
}

function sumChannels({ data }: { data: Channels }): number[] {
  return [
    data.left.reduce((a, b) => a + b, 0),
    data.right.reduce((a, b) => a + b, 0),
  ];
}

function splitChannels({ data }: { data: number[] }): Channels {
  const samples = Float64Array.from(data);
  const half = samples.length / 2;
  return { left: samples.subarray(0, half), right: samples.subarray(half) };
}

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'sumChannels',
        role: 'compute',
        func: sumChannels,
        maxConcurrency: 1,
        retries: 0,
      }),
      defineWorkerConfig({
        name: 'splitChannels',
        role: 'compute',
        func: splitChannels,
      }),
    ),
  });
}

/** Sending two views of one buffer to a worker. */
export async function sendSharedViews() {
  const factory = createFactory();
  const samples = new Float64Array([1, 2, 3, 4]);
  const outcome = await settle(
    factory
      .runWorker('sumChannels', {
        srcData: { left: samples.subarray(0, 2), right: samples.subarray(2) },
      })
      .then(summarize),
  );
  factory.terminate();
  return outcome;
}

/** A worker returning two views of one buffer to the next pipeline step. */
export async function returnSharedViews() {
  const factory = createFactory();
  const outcome = await settle(
    factory
      .pipeline([
        { worker: 'splitChannels', srcData: [1, 2, 3, 4] },
        { worker: 'sumChannels' },
      ])
      .then(summarize),
  );
  factory.terminate();
  return outcome;
}
