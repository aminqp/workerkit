# workerkit

A lightweight TypeScript library for running functions in Web Workers with support for partitioning, retries, and concurrency control — all without the boilerplate.

Instead of manually creating worker scripts and wiring up `postMessage` / `onmessage`, you write plain exported functions and hand them to `MainWorkerFactory`. The library serializes them into Blob workers, manages threads per function, handles retries on failure, and merges results back on the main thread.

---

## Installation

```bash
npm install @offmain/workerkit
# or
pnpm add @offmain/workerkit
```

---

## Quick Start

### 1. Write a worker function

Worker functions live in `*.worker.ts` files and must be plain named exports.

```ts
// sum.worker.ts
export function sum({ data }: { data: number[] }): number {
  return data.reduce((acc, n) => acc + n, 0);
}
```

### 2. Register and run it

```ts
import { MainWorkerFactory } from '@offmain/workerkit';
import { sum } from './sum.worker.ts';

const factory = new MainWorkerFactory({
  workers: [
    {
      name: 'sum',
      role: 'computation',
      func: sum,
      maxConcurrency: 4,
      retries: 2,
    },
  ],
});

const settled = await factory.runWorker('sum', { srcData: [1, 2, 3, 4, 5] });
const { data } = await factory.collectResults(settled);

console.log(data); // [15]
```

---

## WorkerConfig Options

| Option           | Type           | Default                         | Description                                                                                         |
| ---------------- | -------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `name`           | `string`       | —                               | Unique identifier used to call the worker                                                           |
| `role`           | `string`       | —                               | Logical grouping label                                                                              |
| `func`           | `Function`     | —                               | The exported worker function to run (optional if `createWorker` is provided)                        |
| `createWorker`   | `() => Worker` | —                               | Worker factory function `() => new Worker(new URL(...))` for Webpack 5 / Vite static analysis       |
| `maxConcurrency` | `number`       | `navigator.hardwareConcurrency` | Max parallel worker instances — defaults to the number of logical CPU cores reported by the browser |
| `retries`        | `number`       | `0`                             | How many times to retry a failed shard before marking it as rejected                                |
| `partition`      | `boolean`      | `false`                         | Split array input across multiple workers automatically                                             |

---

## Module Bundler Integration (`createWorker`)

When worker logic relies on external npm packages (such as Luxon, `date-fns`, `i18next`, or custom data transformation modules), dynamic inline stringification (`.toString()`) cannot access those closed-over imports.

Passing `createWorker` enables modern module bundlers (Webpack 5, Vite, Rollup, Parcel) to analyze and bundle the worker file along with all of its dependencies into a dedicated ES module worker chunk.

### Dedicated Worker Script

```ts
// transform-data.worker.ts
import { format } from 'date-fns';
import { t } from './i18n.ts';

self.addEventListener('message', (event) => {
  try {
    const { items, locale } = event.data.data;
    const result = items.map((item: any) => ({
      ...item,
      formattedDate: format(new Date(item.timestamp), 'yyyy-MM-dd'),
      label: t('transaction', locale),
    }));

    self.postMessage({ ok: true, data: result });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message });
  }
});
```

### Webpack 5 & Vite Static Analysis (`createWorker`)

Webpack 5 and Vite look for literal `new Worker(new URL(..., import.meta.url))` calls inside consumer source files. By providing a `createWorker` factory function, bundlers statically detect and bundle the worker into a separate JS file, while allowing `MainWorkerFactory` to scale `maxConcurrency` across multiple threads:

```ts
import { MainWorkerFactory } from '@offmain/workerkit';

const factory = new MainWorkerFactory({
  workers: [
    {
      name: 'transformData',
      role: 'compute',
      // Webpack 5 and Vite statically analyze new Worker(new URL(..., import.meta.url))
      // written inside this factory function and emit an individual bundled JS chunk.
      createWorker: () =>
        new Worker(new URL('./transform-data.worker.ts', import.meta.url), {
          type: 'module',
        }),
      maxConcurrency: 4, // Spawns up to 4 parallel worker instances
    },
  ] as const,
});

const settled = await factory.runWorker('transformData', {
  srcData: { locale: 'es', items: [{ timestamp: Date.now() }] },
});
```

---

## Partitioning

When `partition: true`, an array passed as `srcData` is automatically split across worker instances and results are merged back.

```ts
const settled = await factory.runWorker('sum', {
  srcData: largeArray, // split across workers
});

const { data, succeeded, failed } = await factory.collectResults(settled);
```

You can also provide a custom reducer to control how shard results are merged:

```ts
const { data } = await factory.collectResults(settled, {
  reducer: (shards) => shards.flat().sort((a, b) => b.score - a.score),
});
```

> **Note:** The reducer runs inside a worker thread and must be self-contained — it cannot reference variables from the outer scope.

---

## Pipeline

Chain multiple workers together so data flows directly between them via `MessageChannel` — without passing through the main thread between steps.

### Why use a pipeline?

In a traditional multi-step workflow, intermediate data is serialized back to the main thread after each step:

```
Main → Worker A → Main → Worker B → Main → Worker C → Main
         ↑ serialize    ↑ serialize    ↑ serialize
```

With large datasets (100k+ records), each serialization round-trip adds significant overhead — both in time and memory pressure on the main thread. The pipeline eliminates this:

```
Main → Worker A → Worker B → Worker C → Main
                ↑ MessageChannel      ↑ only final result
```

Only the final result crosses back to the main thread. If your pipeline generates 20 MB of intermediate data but produces a 1 KB summary, you save ~40 MB of serialization (two round-trips avoided).

### Usage

```ts
import { MainWorkerFactory } from '@offmain/workerkit';
import { fetchData, transform, aggregate } from './workers.ts';

const factory = new MainWorkerFactory({
  workers: [
    { name: 'fetchData', role: 'io', func: fetchData },
    { name: 'transform', role: 'compute', func: transform },
    { name: 'aggregate', role: 'compute', func: aggregate },
  ] as const,
});

const result = await factory.pipeline<AggregateResult>([
  { worker: 'fetchData', srcData: { url: '/api/records' } },
  { worker: 'transform' }, // receives fetchData output directly
  { worker: 'aggregate' }, // receives transform output directly
]);

console.log(result); // only this small result crossed to main thread
```

### How each step receives data

- The first step receives `srcData` as `{ data: srcData, index: 0 }` — same as `runWorker`.
- Each subsequent step receives the previous step's output as `{ data: previousOutput, index: 0 }`.
- Worker functions don't need any special handling — they use the same `{ data }` parameter signature as regular workers.

### When to use pipeline vs runWorker

| Scenario                                             | Use                     |
| ---------------------------------------------------- | ----------------------- |
| Single step, or steps that need partitioning/retries | `runWorker`             |
| Multi-step chain where intermediate data is large    | `pipeline`              |
| Steps that are independent (not sequential)          | `runWorker` in parallel |
| Steps where only the final result matters to the UI  | `pipeline`              |

---

## Persistent Workers

Keep a worker alive with a cached dataset, then re-run it with different configs without re-sending the data.

### Why use persistent workers?

In a typical workflow where you apply multiple transformations to the same dataset, the standard `runWorker` approach re-serializes the entire dataset on every call:

```
Call 1: Main ──[200k items]──→ Worker → Main
Call 2: Main ──[200k items]──→ Worker → Main   ← same data, different config
Call 3: Main ──[200k items]──→ Worker → Main   ← same data again
```

With 5 config variations on a 1.6 MB dataset, that's ~8 MB of redundant serialization. Persistent workers eliminate this by caching the dataset inside the worker:

```
Call 1: Main ──[200k items + config]──→ Worker → Main   ← dataset cached
Call 2: Main ──[config only]──────────→ Worker → Main   ← reuses cache
Call 3: Main ──[config only]──────────→ Worker → Main   ← reuses cache
```

Only the first call transfers the dataset. Subsequent calls send just the config object (typically a few bytes), saving both serialization time and memory pressure.

### Usage

```ts
import { MainWorkerFactory } from '@offmain/workerkit';
import { transformArray } from './transform.worker.ts';

const factory = new MainWorkerFactory({
  workers: [
    { name: 'transform', role: 'computation', func: transformArray },
  ] as const,
});

// First call: send dataset + config (dataset gets cached in worker memory)
const r1 = await factory.runPersistent('transform', {
  dataset: largeArray,
  config: { multiplier: 2, filter: 'even' },
});

// Subsequent calls: only config — dataset is reused from cache
const r2 = await factory.runPersistent('transform', {
  config: { multiplier: 5, filter: 'odd' },
});

const r3 = await factory.runPersistent('transform', {
  config: { multiplier: 1, filter: 'none', limit: 1000 },
});

// Update the dataset when it changes
const r4 = await factory.runPersistent('transform', {
  dataset: newArray, // replaces cached dataset
  config: { multiplier: 3, filter: 'even' },
});

// Release the worker when done — frees memory
factory.release('transform');
```

### How the worker function receives data

The worker function signature stays the same as a regular worker — it receives `{ data, config }`:

```ts
// transform.worker.ts
export function transformArray({
  data,
  config,
}: {
  data: number[];
  config: { multiplier: number; filter: string };
}) {
  return data
    .filter((n) => /* apply filter */)
    .map((n) => n * config.multiplier);
}
```

The framework handles the caching transparently — your function always receives the full `data` (from cache or freshly provided) plus the current `config`.

### When to use persistent vs runWorker

| Scenario                                               | Use             |
| ------------------------------------------------------ | --------------- |
| One-off computation                                    | `runWorker`     |
| Same dataset, multiple config variations               | `runPersistent` |
| Interactive UI where user tweaks params on static data | `runPersistent` |
| Dataset changes frequently                             | `runWorker`     |
| Need partitioning across multiple threads              | `runWorker`     |

### Memory management

The cached dataset lives in worker memory until `release()` is called. For large datasets, always call `release()` when you're done to free the memory:

```ts
factory.release('transform');
```

After releasing, the next `runPersistent` call will create a fresh worker instance (requiring a new dataset).

---

## ESLint Plugin

The package ships with two ESLint rules to catch common worker mistakes at lint time.

### Setup

```js
// eslint.config.js
import workerPlugin from '@offmain/workerkit/eslint-plugin';

export default [...workerPlugin.configs.recommended];
```

This applies both rules to all `*.worker.ts` and `*.worker.js` files.

### Rules

#### `no-dom-in-worker`

Flags usage of browser main-thread-only APIs that are unavailable inside Web Workers — things like `document`, `window`, `localStorage`, `alert`, DOM constructors, etc.

```ts
// sum.worker.ts ❌ — will be flagged
export function sum({ data }: { data: number[] }) {
  document.title = 'working...'; // Error: 'document' is not available inside Web Workers
  return data.reduce((a, b) => a + b, 0);
}
```

```ts
// sum.worker.ts ✅
export function sum({ data }: { data: number[] }) {
  return data.reduce((a, b) => a + b, 0);
}
```

#### `worker-exportable`

Enforces that worker files only export named functions — the shape required by `MainWorkerFactory`. Flags `export default`, class exports, non-function value exports, and re-exports.

```ts
// bad.worker.ts ❌
export default function() { ... }  // Error: must not use export default
export class MyWorker { ... }      // Error: must not export classes
export const config = { x: 1 };   // Error: must not export non-function values
```

```ts
// good.worker.ts ✅
export function processData({ data }: { data: number[] }) {
  return data.map((n) => n * 2);
}
```

### Using individual rules

You can also import rules individually if you don't want the full recommended config:

```js
// eslint.config.js
import noDomInWorker from '@offmain/workerkit/eslint-rules/no-dom-in-worker';
import workerExportable from '@offmain/workerkit/eslint-rules/worker-exportable';

export default [
  {
    files: ['**/*.worker.ts'],
    plugins: {
      workerkit: {
        rules: {
          'no-dom-in-worker': noDomInWorker,
          'worker-exportable': workerExportable,
        },
      },
    },
    rules: {
      'workerkit/no-dom-in-worker': 'error',
      'workerkit/worker-exportable': 'warn',
    },
  },
];
```

---

## License

MIT
