/**
 * Which worker threads stay alive — the question a long-lived app (e.g. a
 * React SPA that creates factories in components) runs into. Counts live
 * workers with `page.workers()`.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Live worker count once no worker has started or stopped for 500 ms. */
async function liveWorkers(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const count = page.workers().length;
    if (count === last) return count;
    last = count;
  }
  return page.workers().length;
}

/** Forces garbage collection (Chromium only) so finalizers get to run. */
async function collectGarbage(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  for (let i = 0; i < 3; i++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(200);
  }
  await cdp.detach();
}

test.describe('worker lifecycle: which threads stay alive', () => {
  test('creating a factory starts no thread until it is used', async ({
    run,
    page,
  }) => {
    await run('workerLifecycle.createUnused', 5);
    expect(await liveWorkers(page)).toBe(0);
  });

  test('a used factory keeps exactly one MemoryWorker; terminate() stops it', async ({
    run,
    page,
  }) => {
    expect(await run('workerLifecycle.runAndKeep', 3)).toEqual([
      [2, 4, 6],
      [2, 4, 6],
      [2, 4, 6],
    ]);
    // Computing and reducer workers are gone; one MemoryWorker per factory.
    expect(await liveWorkers(page)).toBe(3);
    await run('workerLifecycle.terminateKept');
    expect(await liveWorkers(page)).toBe(0);
  });

  test('a factory dropped without terminate() releases its MemoryWorker once garbage-collected', async ({
    run,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'forcing GC needs Chromium (CDP)');
    expect(await run('workerLifecycle.runAndDrop', 4)).toHaveLength(4);
    await collectGarbage(page);
    expect(await liveWorkers(page)).toBe(0);
  });

  test('garbage collection never stops the MemoryWorker of a factory still in use', async ({
    run,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'forcing GC needs Chromium (CDP)');
    await run('workerLifecycle.runAndKeep', 2);
    await collectGarbage(page);
    expect(await liveWorkers(page)).toBe(2);
    // ...and the kept factories still work afterwards.
    expect(await run('workerLifecycle.runKept')).toEqual([
      [2, 4, 6],
      [2, 4, 6],
    ]);
    await run('workerLifecycle.terminateKept');
  });
});
