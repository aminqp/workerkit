import expensiveComputation1 from './examples/expensive-computation-1.worker.ts';
import { MainWorkerFactory } from './tools';
import { transformArray } from './examples/list-transformer.worker.ts';
import { generateRandomData } from './examples/mocker.worker.ts';
import {
  generateListTransformArrayTestData,
  listTransformArray,
} from './examples/large-ist.worker.ts';
import {
  generateImageData,
  processImageData,
} from './examples/image-processor.worker.ts';
import { generateLogs, analyzeLogs } from './examples/log-analyzer.worker.ts';
import {
  generateDelayedTasks,
  runDelayedTask,
} from './examples/delayed-task.worker.ts';
import { multiplyMatrices } from './examples/benchmark.worker.ts';
import { generateFlakyTasks, flakyTask } from './examples/flaky-task.worker.ts';
import {
  generateSearchShards,
  searchShard,
} from './examples/partial-results.worker.ts';
import { fetchAndEnrichPosts } from './examples/fetch-posts.worker.ts';
import {
  fetchPosts,
  transformPosts,
  filterPosts,
} from './examples/pipeline-demo.worker.ts';
import {
  generateLargeDataset,
  heavyTransform,
  aggregateResults,
} from './examples/pipeline-benchmark.worker.ts';
import { persistentTransform } from './examples/persistent-transform.worker.ts';

import { initDemo } from './demo';

// --- worker setup ---

const workerConfigs = [
  {
    name: 'exp1',
    role: 'computation',
    func: expensiveComputation1,
    retries: 3,
  },
  {
    name: 'generateRandomData',
    role: 'computation',
    func: generateRandomData,
    retries: 3,
    maxConcurrency: 13,
  },
  {
    name: 'transformArray',
    role: 'computation',
    func: transformArray,
    partition: true,
    maxConcurrency: 8,
  },
  {
    name: 'generateListTransformArrayTestData',
    role: 'computation',
    func: generateListTransformArrayTestData,
    partition: true,
    maxConcurrency: 10,
  },
  {
    name: 'listTransformArray',
    role: 'computation',
    func: listTransformArray,
    partition: true,
  },
  {
    name: 'generateImageData',
    role: 'computation',
    func: generateImageData,
    maxConcurrency: 1,
  },
  {
    name: 'processImageData',
    role: 'computation',
    func: processImageData,
    maxConcurrency: 1,
  },
  {
    name: 'generateLogs',
    role: 'computation',
    func: generateLogs,
    partition: true,
    maxConcurrency: 8,
  },
  {
    name: 'analyzeLogs',
    role: 'computation',
    func: analyzeLogs,
    partition: true,
    maxConcurrency: 8,
  },
  {
    name: 'generateDelayedTasks',
    role: 'computation',
    func: generateDelayedTasks,
    maxConcurrency: 1,
  },
  {
    name: 'runDelayedTask',
    role: 'computation',
    func: runDelayedTask,
    partition: true,
    maxConcurrency: 6,
  },
  {
    name: 'multiplyMatrices',
    role: 'computation',
    func: multiplyMatrices,
    partition: true,
    maxConcurrency: 6,
  },
  {
    name: 'generateFlakyTasks',
    role: 'computation',
    func: generateFlakyTasks,
    maxConcurrency: 1,
  },
  {
    name: 'flakyTask',
    role: 'computation',
    func: flakyTask,
    partition: true,
    maxConcurrency: 8,
    retries: 3,
  },
  {
    name: 'generateSearchShards',
    role: 'computation',
    func: generateSearchShards,
    maxConcurrency: 1,
  },
  {
    name: 'searchShard',
    role: 'computation',
    func: searchShard,
    partition: true,
    maxConcurrency: 8,
    retries: 0,
  },
  {
    name: 'fetchAndEnrichPosts',
    role: 'computation',
    func: fetchAndEnrichPosts,
    maxConcurrency: 1,
  },
  {
    name: 'fetchPosts',
    role: 'io',
    func: fetchPosts,
    maxConcurrency: 1,
  },
  {
    name: 'transformPosts',
    role: 'transform',
    func: transformPosts,
    maxConcurrency: 1,
  },
  {
    name: 'filterPosts',
    role: 'transform',
    func: filterPosts,
    maxConcurrency: 1,
  },
  {
    name: 'generateLargeDataset',
    role: 'computation',
    func: generateLargeDataset,
    maxConcurrency: 1,
  },
  {
    name: 'heavyTransform',
    role: 'computation',
    func: heavyTransform,
    maxConcurrency: 1,
  },
  {
    name: 'aggregateResults',
    role: 'computation',
    func: aggregateResults,
    maxConcurrency: 1,
  },
  {
    name: 'persistentTransform',
    role: 'computation',
    func: persistentTransform,
    maxConcurrency: 1,
  },
  {
    name: 'bundlerLuxonI18n',
    role: 'transform',
    createWorker: () =>
      new Worker(
        new URL('./examples/bundler-luxon-i18n.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 2,
  },
  {
    name: 'webpackCreateWorker',
    role: 'computation',
    // Factory function pattern for Webpack 5 / Vite static worker bundling + maxConcurrency scaling
    createWorker: () =>
      new Worker(
        URL.createObjectURL(
          new Blob(
            [
              `self.addEventListener('message', (e) => self.postMessage({ ok: true, data: 'Webpack worker output' }));`,
            ],
            { type: 'application/javascript' },
          ),
        ),
      ),
    maxConcurrency: 4,
  },
  {
    name: 'nativeStep1',
    role: 'io',
    createWorker: () =>
      new Worker(
        new URL('./examples/native-step1.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 1,
  },
  {
    name: 'nativeStep2',
    role: 'transform',
    createWorker: () =>
      new Worker(
        new URL('./examples/native-step2.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 1,
  },
  {
    name: 'nativeStep3',
    role: 'computation',
    createWorker: () =>
      new Worker(
        new URL('./examples/native-step3.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 1,
  },
] as const;

const foreman = new MainWorkerFactory({ workers: workerConfigs });

initDemo(foreman);
