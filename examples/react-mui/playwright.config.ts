import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the app in real browsers, in development (Vite dev server, React
 * StrictMode active) and as a production build.
 *
 *   pnpm test:e2e                                   → Chromium
 *   E2E_BROWSERS=chromium,webkit pnpm test:e2e      → more browsers
 */
const DEV_PORT = 5180;
const PREVIEW_PORT = 5182;

const DEVICES: Record<string, (typeof devices)[string]> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};
const browsers = (process.env.E2E_BROWSERS ?? 'chromium').split(',');
const url = (port: number) => `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  // Each test keeps every core busy for a moment; two at a time is plenty.
  workers: 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: browsers.flatMap((browser) => {
    const device = DEVICES[browser];
    if (!device) throw new Error(`Unknown browser "${browser}"`);
    return [
      { name: `${browser}:dev`, use: { ...device, baseURL: url(DEV_PORT) } },
      {
        name: `${browser}:production`,
        use: { ...device, baseURL: url(PREVIEW_PORT) },
      },
    ];
  }),
  webServer: [
    {
      command: `vite --port ${DEV_PORT} --strictPort --host 127.0.0.1`,
      url: url(DEV_PORT),
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `vite build --logLevel warn && vite preview --port ${PREVIEW_PORT} --strictPort --host 127.0.0.1`,
      url: url(PREVIEW_PORT),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
