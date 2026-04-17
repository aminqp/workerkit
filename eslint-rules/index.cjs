'use strict';

const noDomInWorker = require('./no-dom-in-worker.cjs');
const workerExportable = require('./worker-exportable.cjs');

/** All rules bundled as a flat-config-compatible ESLint plugin */
module.exports = {
  rules: {
    'no-dom-in-worker': noDomInWorker,
    'worker-exportable': workerExportable,
  },

  /**
   * Ready-made flat config that applies both rules to *.worker.ts files.
   *
   * @example
   * // eslint.config.js
   * import workerPlugin from 'workerkit/eslint-plugin';
   * export default [ ...workerPlugin.configs.recommended ];
   */
  configs: {
    recommended: [
      {
        files: ['**/*.worker.ts', '**/*.worker.js'],
        plugins: {
          workerkit: module.exports,
        },
        rules: {
          'workerkit/no-dom-in-worker': 'error',
          'workerkit/worker-exportable': 'error',
        },
      },
    ],
  },
};
