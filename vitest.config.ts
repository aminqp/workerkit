import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Playwright owns e2e/ and the examples' specs — they need a real browser.
    exclude: [...configDefaults.exclude, 'e2e/**', 'examples/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
