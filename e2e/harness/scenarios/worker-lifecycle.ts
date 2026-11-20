/**
 * Which worker threads a factory keeps alive. Frameworks such as React create
 * factories more often than the code suggests (StrictMode renders twice, a
 * factory built during render is rebuilt on every render), so:
 *
 * - creating a factory must not start a thread until it is used;
 * - a used factory that is dropped without `terminate()` must not keep its
 *   MemoryWorker alive forever once it is garbage-collected.
 *
 * The spec counts live workers with Playwright's `page.workers()`.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';

const double = ({ data }: { data: number[] }) => data.map((n) => n * 2);

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
    ),
  });
}

const kept: ReturnType<typeof createFactory>[] = [];

/** Creates factories without using them, and keeps them referenced. */
export async function createUnused(count: number) {
  for (let i = 0; i < count; i++) kept.push(createFactory());
  return count;
}

/** Creates factories, runs one call on each, and keeps them referenced. */
export async function runAndKeep(count: number) {
  const factories = Array.from({ length: count }, createFactory);
  kept.push(...factories);
  const results = await Promise.all(
    factories.map((f) => f.runWorker('double', { srcData: [1, 2, 3] })),
  );
  return results.map((r) => r.data);
}

/** Creates factories, runs one call on each, then drops every reference. */
export async function runAndDrop(count: number) {
  const results = await Promise.all(
    Array.from({ length: count }, () =>
      createFactory().runWorker('double', { srcData: [1, 2, 3] }),
    ),
  );
  return results.map((r) => r.data);
}

/** Runs one call on every kept factory. */
export async function runKept() {
  const results = await Promise.all(
    kept.map((f) => f.runWorker('double', { srcData: [1, 2, 3] })),
  );
  return results.map((r) => r.data);
}

/** Terminates every kept factory. */
export async function terminateKept() {
  for (const factory of kept.splice(0)) factory.terminate();
  return true;
}
