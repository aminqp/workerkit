import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HARNESS_URL = '/workerkit/e2e/harness/index.html';

/** Runs a harness scenario by name and returns its JSON result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RunScenario = (name: string, arg?: unknown) => Promise<any>;

/**
 * `run` fixture: opens the harness page and fails the test if the page throws
 * an uncaught error (or has an unhandled rejection) while the scenario runs.
 */
export const test = base.extend<{ run: RunScenario }>({
  run: async ({ page }, use) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    // A reload mid-test (e.g. the dev server reacting to a file change) wipes
    // every worker and factory; report it as such instead of as odd results.
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        pageErrors.push('the harness page reloaded during the test');
      }
    });
    await use((name, arg) =>
      page.evaluate(
        ({ name, arg }) => {
          const registry = (
            window as unknown as {
              scenarios: Record<string, (arg?: unknown) => Promise<unknown>>;
            }
          ).scenarios;
          const scenario = registry[name];
          if (!scenario) throw new Error(`Unknown scenario: ${name}`);
          return scenario(arg);
        },
        { name, arg },
      ),
    );
    expect(pageErrors, 'uncaught errors in the harness page').toEqual([]);
  },
});

export { expect };

export const fulfilled = (value: unknown) => ({ status: 'fulfilled', value });

export const rejected = (pattern: RegExp) => ({
  status: 'rejected',
  error: expect.stringMatching(pattern),
});

/** The repository's README, which some specs check against the code. */
const README = fileURLToPath(new URL('../../README.md', import.meta.url));

/** Reads README.md (a fixed path — no caller-supplied paths are read). */
export function readReadme(): string {
  return readFileSync(README, 'utf8');
}
