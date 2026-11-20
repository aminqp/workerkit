import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * End-to-end tests in real browsers.
 *
 *   pnpm test:e2e                       → Chromium, library from src/
 *   E2E_DIST=1 pnpm test:e2e            → also run the harness against dist/
 *   E2E_BROWSERS=chromium,firefox,webkit pnpm test:e2e
 *
 * The harness (timing-sensitive) and the demo (CPU-heavy: one card generates
 * 4 million log entries on 8 threads) run as two separate passes — see
 * package.json.
 *
 * Projects per browser:
 *   <browser>:harness       one scenario per finding, library from src/
 *   <browser>:harness-dist  same scenarios against the built package (E2E_DIST=1)
 *   <browser>:demo          every demo card, Vite dev server
 *   <browser>:demo-prod     every demo card, minified production build
 */
const PORTS = { src: 5199, dist: 5198, prod: 5197 } as const;
const HARNESS_PATH = '/workerkit/e2e/harness/index.html';
const DEMO_PRODUCTION_DIR = 'e2e/.demo-dist';

const includeDist = process.env.E2E_DIST === '1';
const browsers = (process.env.E2E_BROWSERS ?? 'chromium').split(',');

const DEVICES: Record<string, (typeof devices)[string]> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

const url = (port: number, path = '/workerkit/') =>
  `http://127.0.0.1:${port}${path}`;

function projectsFor(browser: string): Project[] {
  const device = DEVICES[browser];
  if (!device) throw new Error(`Unknown browser "${browser}"`);
  return [
    {
      name: `${browser}:harness`,
      testIgnore: /demo\.spec\.ts/,
      use: { ...device, baseURL: url(PORTS.src, '') },
    },
    ...(includeDist
      ? [
          {
            name: `${browser}:harness-dist`,
            testIgnore: /demo\.spec\.ts/,
            use: { ...device, baseURL: url(PORTS.dist, '') },
          },
        ]
      : []),
    {
      name: `${browser}:demo`,
      testMatch: /demo\.spec\.ts/,
      use: { ...device, baseURL: url(PORTS.src, '') },
    },
    {
      name: `${browser}:demo-prod`,
      testMatch: /demo\.spec\.ts/,
      use: { ...device, baseURL: url(PORTS.prod, '') },
    },
  ];
}

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: browsers.flatMap(projectsFor),
  webServer: [
    {
      command: `pnpm exec vite --config e2e/vite.config.ts --port ${PORTS.src}`,
      url: url(PORTS.src, HARNESS_PATH),
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        `pnpm exec vite build --outDir ${DEMO_PRODUCTION_DIR} --emptyOutDir --logLevel warn && ` +
        `pnpm exec vite preview --outDir ${DEMO_PRODUCTION_DIR} --port ${PORTS.prod} --strictPort --host 127.0.0.1`,
      url: url(PORTS.prod),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...(includeDist
      ? [
          {
            command:
              `pnpm exec vite build --config vite.lib.config.ts --logLevel warn && ` +
              `pnpm exec vite --config e2e/vite.config.ts --port ${PORTS.dist}`,
            env: { E2E_TARGET: 'dist' },
            url: url(PORTS.dist, HARNESS_PATH),
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
