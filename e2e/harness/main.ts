/**
 * Registers every scenario on `window.scenarios` so Playwright specs can run
 * them by name, then marks the page ready.
 */
import * as reset from './scenarios/reset';
import * as terminate from './scenarios/terminate';
import * as persistent from './scenarios/persistent';
import * as defineWorkerPersistent from './scenarios/define-worker-persistent';
import * as partition from './scenarios/partition';
import * as memory from './scenarios/memory';
import * as retries from './scenarios/retries';
import * as arrowFunctions from './scenarios/arrow-functions';
import * as transfer from './scenarios/transfer';
import * as handwrittenWorkers from './scenarios/handwritten-workers';
import * as reducerFallback from './scenarios/reducer-fallback';
import * as workerLifecycle from './scenarios/worker-lifecycle';
import * as memoryHub from './scenarios/memory-hub';

type Scenario = (arg?: never) => Promise<unknown>;

const groups: Record<string, Record<string, unknown>> = {
  reset,
  terminate,
  persistent,
  defineWorkerPersistent,
  partition,
  memory,
  retries,
  arrowFunctions,
  transfer,
  handwrittenWorkers,
  reducerFallback,
  workerLifecycle,
  memoryHub,
};

const scenarios: Record<string, Scenario> = {};
for (const [group, exports] of Object.entries(groups)) {
  for (const [name, fn] of Object.entries(exports)) {
    if (typeof fn === 'function')
      scenarios[`${group}.${name}`] = fn as Scenario;
  }
}

(window as unknown as { scenarios: typeof scenarios }).scenarios = scenarios;
document.body.dataset.ready = 'true';
