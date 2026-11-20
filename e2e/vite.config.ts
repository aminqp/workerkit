import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Dev server used by the Playwright e2e suite.
 *
 * Serves both the demo app (`/workerkit/`) and the e2e harness
 * (`/workerkit/e2e/harness/index.html`). The harness imports the library the
 * way a consumer would (`@offmain/workerkit`, `@offmain/workerkit/define-worker`);
 * `E2E_TARGET=dist` points those imports at the built package in `dist/`
 * instead of the TypeScript sources, so the published bundle gets exercised too.
 *
 * `E2E_LIB_SRC=/path/to/src/tools` points them at another copy of the library
 * sources — e.g. a released version extracted with `git archive` — so the same
 * suite can be compared before and after a change.
 */
const root = resolve(__dirname, '..');
const useDist = process.env.E2E_TARGET === 'dist';
const libSrc = process.env.E2E_LIB_SRC
  ? resolve(process.env.E2E_LIB_SRC)
  : resolve(root, 'src/tools');

const entries = useDist
  ? {
      main: resolve(root, 'dist/index.js'),
      defineWorker: resolve(root, 'dist/define-worker.js'),
    }
  : {
      main: resolve(libSrc, 'index.ts'),
      defineWorker: resolve(libSrc, 'define-worker/index.ts'),
    };

export default defineConfig({
  root,
  base: '/workerkit/',
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: /^@offmain\/workerkit\/define-worker$/,
        replacement: entries.defineWorker,
      },
      { find: /^@offmain\/workerkit$/, replacement: entries.main },
    ],
  },
  server: {
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [root, libSrc] },
    // The server's root is the whole repository. Build and test output must
    // not be watched: Vite reloads every open page when an HTML file changes
    // (e.g. a demo build writing e2e/.demo-dist/index.html), which would kill
    // harness tests mid-run.
    watch: {
      ignored: [
        '**/e2e/.demo-dist/**',
        '**/dist/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/examples/**',
      ],
    },
  },
  preview: { strictPort: true, host: '127.0.0.1' },
});
