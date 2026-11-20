import { test, expect, type Page } from '@playwright/test';

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
});

test.afterEach(() => {
  expect(pageErrors, 'uncaught errors on the page').toEqual([]);
});

/** Waits until the run with this `runId` has finished. */
async function waitForRun(page: Page, runId = 0) {
  await expect(page.locator('[data-completed-run]')).toHaveAttribute(
    'data-completed-run',
    String(runId),
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('status')).toHaveText('Done');
}

/** Live worker threads, once none has started or stopped for 500 ms. */
async function liveWorkers(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const count = page.workers().length;
    if (count === last) return count;
    last = count;
  }
  return page.workers().length;
}

test('transforms 100,000 rows in workers and lists every one, in order', async ({
  page,
}) => {
  await waitForRun(page);
  await expect(page.getByTestId('row-count')).toHaveText('100,000');

  const rows = page.getByTestId('transaction-row');
  await expect(rows.first()).toContainText('#0 ·');
  await expect(rows.first()).toContainText(/[$€£¥][\d,]+/);

  // The last row is #99999: every partition came back, in order.
  await page
    .getByTestId('transaction-list')
    .evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
  await expect(page.getByText(/^#99999 ·/)).toBeVisible();

  await expect(page.getByTestId('summary')).toContainText(
    '100,000 transactions',
  );
  await expect(page.getByTestId('summary-category')).toHaveCount(8);
});

test('keeps one worker thread alive — the MemoryWorker — across runs', async ({
  page,
}) => {
  await waitForRun(page);
  // Generator, transform and reducer workers are gone once a run finishes.
  expect(await liveWorkers(page)).toBe(1);

  for (let runId = 1; runId <= 3; runId++) {
    await page.getByTestId('run-again').click();
    await waitForRun(page, runId);
  }
  expect(await liveWorkers(page)).toBe(1);

  // Each step frees what it read, so nothing stays stored between runs.
  await expect(page.getByTestId('memory-handles')).toHaveText('0');
});

test('filters the transformed rows', async ({ page }) => {
  await waitForRun(page);
  await page.getByLabel('Filter rows').fill('coho winery');

  const rows = page.getByTestId('transaction-row');
  await expect(page.getByTestId('visible-count')).not.toHaveText(
    '100,000 shown',
  );
  await expect
    .poll(async () => {
      const texts = await rows.allTextContents();
      return texts.length > 0 && texts.every((t) => t.includes('Coho Winery'));
    })
    .toBe(true);
});
