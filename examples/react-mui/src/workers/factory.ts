import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import {
  generateTransactions,
  summarizeTransactions,
  transformTransactions,
} from './transactions.worker';

/** Threads per partitioned step: one per core, at most 8. */
export const THREADS = Math.min(navigator.hardwareConcurrency || 4, 8);

/**
 * One factory for the whole app, created once at module level.
 *
 * Every factory owns a long-lived thread — its MemoryWorker — that runs until
 * `terminate()`. So don't create factories in a component body or `useMemo`:
 * React re-renders, remounts and (in StrictMode) double-invokes those, and
 * each extra factory that gets used keeps another thread running. If a
 * factory must belong to a component, create it in `useEffect` and call
 * `terminate()` in the effect's cleanup.
 */
export const workerFactory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    // 1. Generate rows. `memoryOnly`: the rows stay in the MemoryWorker and
    //    only a `__memory_ref__` comes back — they never reach the main thread.
    defineWorkerConfig({
      name: 'generate',
      role: 'data',
      func: generateTransactions,
      partition: true,
      maxConcurrency: THREADS,
      memoryOnly: true,
    }),
    // 2. Transform them, split across THREADS workers: each reads its part of
    //    the raw rows straight from the MemoryWorker. `memory`: the result
    //    comes back for the list *and* stays stored for the next step.
    defineWorkerConfig({
      name: 'transform',
      role: 'compute',
      func: transformTransactions,
      partition: true,
      maxConcurrency: THREADS,
      memory: true,
    }),
    // 3. Summarize the stored rows — the worker reads them from the
    //    MemoryWorker; they don't cross the main thread again.
    defineWorkerConfig({
      name: 'summarize',
      role: 'compute',
      func: summarizeTransactions,
      maxConcurrency: 1,
    }),
  ),
});

// Vite re-runs this module after you edit it (or the worker functions):
// stop the old factory's threads so they don't pile up during development.
if (import.meta.hot) {
  import.meta.hot.dispose(() => workerFactory.terminate());
}
