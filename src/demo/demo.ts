import expensiveComputation1 from './examples/expensive-computation-1.worker.ts';
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '../tools/index.ts';
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
import {
  generateMemoryData,
  generateMemoryDataWithPayload,
  processMemoryData,
} from './examples/memory-demo.worker.ts';

import type {
  DataPayload,
  TransformedItem,
} from './examples/bundler-luxon-i18n.worker.ts';

// --- worker setup ---

const workerConfigs = defineWorkerConfigs(
  defineWorkerConfig({
    name: 'exp1',
    role: 'computation',
    func: expensiveComputation1,
    retries: 3,
  }),
  defineWorkerConfig({
    name: 'generateRandomData',
    role: 'computation',
    func: generateRandomData,
    retries: 3,
    maxConcurrency: 13,
  }),
  defineWorkerConfig({
    name: 'transformArray',
    role: 'computation',
    func: transformArray,
    partition: true,
    maxConcurrency: 8,
  }),
  defineWorkerConfig({
    name: 'generateListTransformArrayTestData',
    role: 'computation',
    func: generateListTransformArrayTestData,
    partition: true,
    maxConcurrency: 10,
  }),
  defineWorkerConfig({
    name: 'listTransformArray',
    role: 'computation',
    func: listTransformArray,
    partition: true,
  }),
  defineWorkerConfig({
    name: 'generateImageData',
    role: 'computation',
    func: generateImageData,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'processImageData',
    role: 'computation',
    func: processImageData,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'generateLogs',
    role: 'computation',
    func: generateLogs,
    partition: true,
    maxConcurrency: 8,
  }),
  defineWorkerConfig({
    name: 'analyzeLogs',
    role: 'computation',
    func: analyzeLogs,
    partition: true,
    maxConcurrency: 8,
  }),
  defineWorkerConfig({
    name: 'generateDelayedTasks',
    role: 'computation',
    func: generateDelayedTasks,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'runDelayedTask',
    role: 'computation',
    func: runDelayedTask,
    partition: true,
    maxConcurrency: 6,
  }),
  defineWorkerConfig({
    name: 'multiplyMatrices',
    role: 'computation',
    func: multiplyMatrices,
    partition: true,
    maxConcurrency: 6,
  }),
  defineWorkerConfig({
    name: 'generateFlakyTasks',
    role: 'computation',
    func: generateFlakyTasks,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'flakyTask',
    role: 'computation',
    func: flakyTask,
    partition: true,
    maxConcurrency: 8,
    retries: 3,
  }),
  defineWorkerConfig({
    name: 'generateSearchShards',
    role: 'computation',
    func: generateSearchShards,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'searchShard',
    role: 'computation',
    func: searchShard,
    partition: true,
    maxConcurrency: 8,
    retries: 0,
  }),
  defineWorkerConfig({
    name: 'fetchAndEnrichPosts',
    role: 'computation',
    func: fetchAndEnrichPosts,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'fetchPosts',
    role: 'io',
    func: fetchPosts,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'transformPosts',
    role: 'transform',
    func: transformPosts,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'filterPosts',
    role: 'transform',
    func: filterPosts,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'generateLargeDataset',
    role: 'computation',
    func: generateLargeDataset,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'heavyTransform',
    role: 'computation',
    func: heavyTransform,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'aggregateResults',
    role: 'computation',
    func: aggregateResults,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'persistentTransform',
    role: 'computation',
    func: persistentTransform,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'generateMemoryData',
    role: 'computation',
    func: generateMemoryData,
    memoryOnly: true,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'generateMemoryDataWithPayload',
    role: 'computation',
    func: generateMemoryDataWithPayload,
    memory: true,
    maxConcurrency: 1,
  }),
  defineWorkerConfig({
    name: 'processMemoryData',
    role: 'computation',
    func: processMemoryData,
    maxConcurrency: 1,
  }),
  defineWorkerConfig<(p: { data: DataPayload }) => TransformedItem[]>()({
    name: 'bundlerLuxonI18n',
    role: 'transform',
    createWorker: () =>
      new Worker(
        new URL('./examples/bundler-luxon-i18n.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 2,
  }),
  defineWorkerConfig<(p: { data: unknown }) => { ok: boolean; data: string }>()(
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
  ),
  defineWorkerConfig<
    (p: { data: { count?: number } }) => { id: number; rawScore: number }[]
  >()({
    name: 'nativeStep1',
    role: 'io',
    createWorker: () =>
      new Worker(
        new URL('./examples/native-step1.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 1,
  }),
  defineWorkerConfig<
    (p: {
      data: { id: number; rawScore: number }[];
    }) => { id: number; finalScore: number }[]
  >()({
    name: 'nativeStep2',
    role: 'transform',
    createWorker: () =>
      new Worker(
        new URL('./examples/native-step2.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 1,
  }),
  defineWorkerConfig<
    (p: { data: { id: number; finalScore: number }[] }) => {
      totalItems: number;
      averageScore: number;
    }
  >()({
    name: 'nativeStep3',
    role: 'computation',
    createWorker: () =>
      new Worker(
        new URL('./examples/native-step3.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    maxConcurrency: 1,
  }),
);

export const foreman = new MainWorkerFactory({
  workers: workerConfigs,
  logLevel: 'verbose',
});
