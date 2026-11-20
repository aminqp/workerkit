/**
 * Real-world check: drive every card of the demo app the way a visitor would
 * and require each one to finish without an error. The demo exercises every
 * public API, bundled workers with npm dependencies (Luxon, i18next), and
 * large datasets, so it doubles as an integration test of the library.
 *
 * The two cards that fetch from jsonplaceholder get a local fixture so the
 * run does not depend on a third-party service.
 */
import { test, expect, type Page } from '@playwright/test';

const POSTS = Array.from({ length: 100 }, (_, i) => ({
  userId: (i % 10) + 1,
  id: i + 1,
  title: `fixture post number ${i + 1}`,
  body: `body of fixture post ${i + 1}\nsecond line`,
}));

test.describe.configure({ mode: 'default' });

let pageErrors: string[] = [];

test.beforeEach(async ({ page, context }) => {
  pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await context.route('https://jsonplaceholder.typicode.com/**', (route) => {
    const limit = Number(
      new URL(route.request().url()).searchParams.get('_limit') ?? 100,
    );
    return route.fulfill({ json: POSTS.slice(0, limit) });
  });
  await page.goto('/workerkit/');
});

test.afterEach(() => {
  expect(pageErrors, 'uncaught errors in the demo page').toEqual([]);
});

/** Clicks a card's button and waits for the card to finish; fails on error. */
async function runCard(page: Page, id: string, button = `#btn-${id}`) {
  await page.click(button);
  const status = page.locator(`#status-${id}`);
  await expect(status).toHaveClass(/\b(done|partial|error)\b/, {
    timeout: 90_000,
  });
  const result = (await page.locator(`#result-${id}`).textContent()) ?? '';
  await expect(status, `card "${id}" failed: ${result}`).not.toHaveClass(
    /\berror\b/,
  );
  return result;
}

const SIMPLE_CARDS = [
  'exp1',
  'gen',
  'transform',
  'list',
  'image',
  'logs',
  'delayed',
  'flaky',
  'partial',
  'bench',
  'fetch',
  'pipeline',
  'pipeline-bench',
  'persistent-bench',
  'worker-instance',
  'native-pipeline',
];

for (const id of SIMPLE_CARDS) {
  test(`card "${id}" completes`, async ({ page }) => {
    test.setTimeout(120_000);
    await runCard(page, id);
  });
}

test('card "bundler" transforms each input item exactly once', async ({
  page,
}) => {
  const result = await runCard(page, 'bundler');
  expect(result).toContain('3 items transformed');
});

test('card "persistent": run, re-run from cache, release', async ({ page }) => {
  const first = await runCard(page, 'persistent');
  expect(first).toContain('Run 2 (config only)');

  await page.click('#btn-persistent-rerun');
  await expect(page.locator('#result-persistent')).not.toHaveText(first, {
    timeout: 30_000,
  });
  await expect(page.locator('#status-persistent')).toHaveClass(/\bdone\b/);

  await page.click('#btn-persistent-release');
  await expect(page.locator('#status-persistent')).toHaveText(
    /worker released/,
  );
});

test('card "memory": produce a ref, consume it, inspect and clear', async ({
  page,
}) => {
  const result = await runCard(page, 'memory');
  expect(result).toContain('Active Memory Handles Remaining: 0');

  await page.click('#btn-memory-stats');
  await expect(page.locator('#status-memory')).toHaveText(
    /Active Memory Handles: 0/,
  );

  await page.click('#btn-memory-clear');
  await expect(page.locator('#status-memory')).toHaveText(/Memory Cleared!/);
});
