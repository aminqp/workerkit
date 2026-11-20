'use strict';

const noDomInWorker = require('./no-dom-in-worker.cjs');
const workerExportable = require('./worker-exportable.cjs');

/** All rules bundled as a flat-config-compatible ESLint plugin */
const plugin = {
  meta: { name: '@offmain/workerkit/eslint-plugin' },
  rules: {
    'no-dom-in-worker': noDomInWorker,
    'worker-exportable': workerExportable,
  },
  configs: {},
};

/**
 * Ready-made flat config that applies both rules to *.worker.ts files.
 *
 * Defined after `plugin` exists: the config must reference the plugin object
 * itself. (Referencing `module.exports` inside the object literal that is
 * being assigned to it captures the original empty exports object, and ESLint
 * then cannot find any of the rules.)
 *
 * @example
 * // eslint.config.js
 * import workerPlugin from '@offmain/workerkit/eslint-plugin';
 * export default [ ...workerPlugin.configs.recommended ];
 */
plugin.configs.recommended = [
  {
    files: ['**/*.worker.ts', '**/*.worker.js'],
    plugins: {
      workerkit: plugin,
    },
    rules: {
      'workerkit/no-dom-in-worker': 'error',
      'workerkit/worker-exportable': 'error',
    },
  },
];

module.exports = plugin;
