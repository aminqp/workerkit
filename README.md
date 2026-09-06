# workerkit

A lightweight TypeScript library for running functions in Web Workers with support for partitioning, retries, and concurrency control all without the boilerplate.

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
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { sum } from './sum.worker.ts';

const factory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    defineWorkerConfig({
      name: 'sum',
      role: 'computation',
      func: sum,
      maxConcurrency: 4,
      retries: 2,
    }),
  ),
});

// Fully type-safe: 'sum' autocompletes, srcData is type-checked, and data is typed as number[]!
const { data, succeeded } = await factory.runWorker('sum', {
  srcData: [1, 2, 3, 4, 5],
});

console.log(data); // [15]
```

---

## WorkerConfig Options

| Option           | Type           | Default                               | Description                                                                                         |
| ---------------- | -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `name`           | `string`       | —                                     | Unique identifier used to call the worker                                                           |
| `role`           | `string`       | —                                     | Logical grouping label                                                                              |
| `func`           | `Function`     | —                                     | The exported worker function to run (optional if `createWorker` is provided)                        |
| `createWorker`   | `() => Worker` | —                                     | Worker factory function `() => new Worker(new URL(...))` for Webpack 5 / Vite static analysis       |
| `maxConcurrency` | `number`       | `navigator.`<br>`hardwareConcurrency` | Max parallel worker instances — defaults to the number of logical CPU cores reported by the browser |
| `retries`        | `number`       | `0`                                   | How many times to retry a failed shard before marking it as rejected                                |
| `partition`      | `boolean`      | `false`                               | Split array input across multiple workers automatically                                             |

---

## 🎯 Type-Friendly Configuration & Strict Inference

`workerkit` provides first-class, end-to-end TypeScript safety. You get full autocompletion for registered worker names, compile-time validation of input payloads (`srcData`), and strongly typed return data without manual type assertions.

### `defineWorkerConfig` & `defineWorkerConfigs`

Use `defineWorkerConfigs(...)` and `defineWorkerConfig(...)` to declare your worker suite. This eliminates the need for manual `as const` casts while preserving literal worker names:

```ts
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { sum } from './sum.worker.ts';
import type { DataPayload, TransformedItem } from './transform.worker.ts';

const workerConfigs = defineWorkerConfigs(
  // 1. Inlined function — input and output types are inferred automatically from `func`
  defineWorkerConfig({
    name: 'sum',
    role: 'computation',
    func: sum,
    maxConcurrency: 4,
  }),

  // 2. Bundled worker (createWorker) — explicit types via currying
  defineWorkerConfig<(p: { data: DataPayload }) => TransformedItem[]>()({
    name: 'transform',
    role: 'transform',
    createWorker: () =>
      new Worker(new URL('./transform.worker.ts', import.meta.url), {
        type: 'module',
      }),
    maxConcurrency: 2,
  }),
);

const factory = new MainWorkerFactory({ workers: workerConfigs });

// ✅ 'sum' and 'transform' autocomplete in your IDE
// ✅ srcData is type-checked against DataPayload
// ✅ data is typed as TransformedItem[] (NOT unknown!)
const { data } = await factory.runWorker('transform', {
  srcData: { items: [], locale: 'en' },
});
```

### 🔄 Migrating from v0.14.1 to v1.0.0 (Breaking Changes)

The upcoming **v1.0.0** release transforms `workerkit` into a modern, type-friendly library and streamlines the worker execution model. If you are upgrading from **v0.14.1** (published on npm), review the concrete breaking changes and migration steps below:

| Feature                        | In `v0.14.1`                                                                                                                                           | In `v1.0.0`                                                                                                                                       | Migration Action                                                                                                                                  |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Worker Registration**        | Pure raw object literals with mandatory `as const`: `[{ name: 'calc', func, ... }] as const`. Workers using `createWorker` had **no way to be typed**. | Replaced by `defineWorkerConfigs(...)` and `defineWorkerConfig(...)`. `createWorker` can now be strongly typed via currying.                      | Wrap configs with `defineWorkerConfigs(defineWorkerConfig({...}))`. Remove `as const`.                                                            |
| **`runWorker()` Execution**    | **Two-step execution**: returned `TypedSettledResults` requiring an explicit `const { data } = await factory.collectResults(settled)`.                 | **Single-step execution**: auto-collects by default, directly returning `Promise<CollectedResult<R>>` with `{ data, succeeded, failed, errors }`. | Remove `collectResults(...)`. Destructure `{ data }` directly from `runWorker()`. Pass `autoCollect: false` only if you need raw settled results. |
| **`createWorker` Type Safety** | Untyped: lacked any type hint mechanism. Payloads and return values for bundled workers were always `unknown`.                                         | **Curried Type Hint**: `defineWorkerConfig<WorkerFunctionType>()({ name: '...', createWorker: ... })` provides 100% type safety.                  | Use curried `defineWorkerConfig<T>()({...})` to define input and output types for bundled workers without runtime overhead.                       |
| **`pipeline()` Return Value**  | Returned the unwrapped raw final value: `Promise<TResult>`.                                                                                            | Returns `Promise<CollectedResult<TResult>>` unified with `runWorker()`, including execution statistics (`succeeded`, `failed`, `errors`).         | Access the final pipeline output via `result.data` instead of directly awaiting `result`.                                                         |
| **`runPersistent()` Typing**   | `workerName` accepted any `string`, and the return type defaulted to untyped `unknown`.                                                                | Strictly typed: `workerName` autocompletes from registered configs, and return value is inferred from that worker's return type.                  | No casting needed — results are automatically type-safe.                                                                                          |

#### Concrete Code Comparison (v0.14.1 vs v1.0.0)

```ts
// ============================================================================
// ❌ v0.14.1 (Pure configs + as const + 2-step execution + untyped createWorker)
// ============================================================================
import { MainWorkerFactory } from '@offmain/workerkit';
import { calcWorker } from './calc.worker';

const factory = new MainWorkerFactory({
  workers: [
    {
      name: 'calc',
      role: 'computation',
      func: calcWorker,
    },
    {
      name: 'bundled',
      role: 'computation',
      // In v0.14.1, createWorker had NO way to define parameter or return types:
      createWorker: () =>
        new Worker(new URL('./bundled.worker.ts', import.meta.url), {
          type: 'module',
        }),
    },
  ] as const, // Required 'as const' to preserve name literals
});

// Required two separate steps to get data:
const settled = await factory.runWorker('calc', { srcData: [1, 2, 3] });
const { data } = await factory.collectResults(settled);

// pipeline() returned raw unwrapped value:
const pipelineResult = await factory.pipeline([
  { worker: 'calc', srcData: [1, 2, 3] },
]);

// ============================================================================
// ✅ v1.0.0 (Type-friendly helpers + 1-step execution + fully-typed createWorker)
// ============================================================================
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { calcWorker } from './calc.worker';
import type { BundledPayload, BundledResult } from './bundled.worker';

const factory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    // Inferred automatically from `func`:
    defineWorkerConfig({
      name: 'calc',
      role: 'computation',
      func: calcWorker,
    }),
    // Explicitly typed via curried signature (no 'unknown' returns!):
    defineWorkerConfig<(p: { data: BundledPayload }) => BundledResult>()({
      name: 'bundled',
      role: 'computation',
      createWorker: () =>
        new Worker(new URL('./bundled.worker.ts', import.meta.url), {
          type: 'module',
        }),
    }),
  ), // No 'as const' needed!
});

// 1-step execution: autocompletes 'calc', validates srcData, and data is typed!
const { data, succeeded } = await factory.runWorker('calc', {
  srcData: [1, 2, 3],
});

// pipeline() returns CollectedResult with stats:
const { data: pipelineData } = await factory.pipeline([
  { worker: 'calc', srcData: [1, 2, 3] },
]);
```

---

## Module Bundler Integration (`createWorker`)

When worker logic relies on external npm packages (such as Luxon, `date-fns`, `i18next`, or custom data transformation modules), dynamic inline stringification (`.toString()`) cannot access those closed-over imports.

Passing `createWorker` enables modern module bundlers (Webpack 5, Vite, Rollup, Parcel) to analyze and bundle the worker file along with all of its dependencies into a dedicated ES module worker chunk.

### Dedicated Worker Script with `defineWorker`

When writing standalone worker files, wrap your export in `defineWorker`. This automatically handles standard runs, worker-to-worker pipelines (`pipeline()`), and persistent dataset caching without manual `postMessage` / `onmessage` boilerplate:

```ts
// transform-data.worker.ts
import { defineWorker } from '@offmain/workerkit';
import { format } from 'date-fns';
import { t } from './i18n.ts';

export default defineWorker(
  async ({
    data,
    options,
  }: {
    data: { items: any[]; locale: string };
    options?: { prefix?: string };
  }) => {
    const { items, locale } = data;
    return items.map((item: any) => ({
      ...item,
      formattedDate: format(new Date(item.timestamp), 'yyyy-MM-dd'),
      label: (options?.prefix ?? '') + t('transaction', locale),
    }));
  },
);
```

### Webpack 5 & Vite Static Analysis (`createWorker`)

Webpack 5 and Vite look for literal `new Worker(new URL(..., import.meta.url))` calls inside consumer source files. By providing a `createWorker` factory function, bundlers statically detect and bundle the worker into a separate JS file, while allowing `MainWorkerFactory` to scale `maxConcurrency` across multiple threads:

```ts
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';

const factory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    defineWorkerConfig<
      (p: { data: { locale: string; items: { timestamp: number }[] } }) => any
    >()({
      name: 'transformData',
      role: 'compute',
      // Webpack 5 and Vite statically analyze new Worker(new URL(..., import.meta.url))
      // written inside this factory function and emit an individual bundled JS chunk.
      createWorker: () =>
        new Worker(new URL('./transform-data.worker.ts', import.meta.url), {
          type: 'module',
        }),
      maxConcurrency: 4, // Spawns up to 4 parallel worker instances
    }),
  ),
});

const { data } = await factory.runWorker('transformData', {
  srcData: { locale: 'es', items: [{ timestamp: Date.now() }] },
});
```

---

## Partitioning

When `partition: true`, an array passed as `srcData` is automatically split across worker instances and results are merged back.

```ts
// Results are automatically merged and returned by default!
const { data, succeeded, failed } = await factory.runWorker('sum', {
  srcData: largeArray, // split across workers
});
```

You can also provide a custom reducer directly to `runWorker` to control how shard results are merged:

```ts
const { data } = await factory.runWorker('sum', {
  srcData: largeArray,
  reducer: (shards) => shards.flat().sort((a, b) => b.score - a.score),
});
```

_(Optional escape hatch: pass `autoCollect: false` to `runWorker` to receive raw settled results and manually call `factory.collectResults(settled, options)`)._

> **Note:** The reducer runs inside a worker thread and must be self-contained — it cannot reference variables from the outer scope.

### Dynamic Thread Scaling & Partitioning Behavior

When `partition: true` is enabled on a worker:

- **Dynamic Thread Allocation:** The library calculates worker thread count as `Math.min(maxConcurrency, srcData.length)`. For instance, if an array has 2 items and `maxConcurrency` is 20, the factory will spawn **only 2 worker threads** (instead of 20), eliminating idle thread overhead and memory pressure.
- **No Data Duplication:** Each thread receives only its assigned chunk (e.g. Worker 0 gets `[item1]`, Worker 1 gets `[item2]`), ensuring results are processed once without duplication.
- **Non-Partitioned Workers (`partition: false` / omitted):** If `partition` is not enabled, the input payload is not split, and up to `maxConcurrency` threads will each execute the full payload independently in parallel.

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
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { fetchData, transform, aggregate } from './workers.ts';

const factory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    defineWorkerConfig({ name: 'fetchData', role: 'io', func: fetchData }),
    defineWorkerConfig({ name: 'transform', role: 'compute', func: transform }),
    defineWorkerConfig({ name: 'aggregate', role: 'compute', func: aggregate }),
  ),
});
```

### Step-Specific Options and Configs in Pipeline

You can pass step-specific parameters (such as `options`, `configs`, etc.) directly to each pipeline step:

```ts
const result = await factory.pipeline<AggregateResult>([
  {
    worker: 'fetchData',
    srcData: { url: '/api/records' },
    options: { timeout: 5000 },
  },
  {
    worker: 'transform',
    configs: { multiplier: 2 },
  },
  {
    worker: 'aggregate',
    options: { threshold: 10 },
  },
]);
```

### How each step receives data and parameters

- The first step receives `srcData` merged with its step parameters as `{ data: srcData, options: { timeout: 5000 }, index: 0 }`.
- Each subsequent step receives the previous step's output merged with its step parameters as `{ data: previousOutput, configs: { multiplier: 2 }, index: 0 }`.
- Worker functions (both inline functions and native scripts using `defineWorker`) receive all step parameters in their first argument.

### When to use pipeline vs runWorker

| Scenario                                                      | Use                     |
| ------------------------------------------------------------- | ----------------------- |
| Single step, or steps that need multi-core array partitioning | `runWorker`             |
| Multi-step chain where intermediate data is large             | `pipeline`              |
| Steps that are independent (not sequential)                   | `runWorker` in parallel |
| Steps where only the final result matters to the UI           | `pipeline`              |

> **Note on `partition: true` in Pipelines:**  
> `pipeline()` creates **1 worker thread per step** in a linear 1:1 `MessageChannel` chain. If a worker in a pipeline step has `partition: true`, `pipeline()` processes it as a single streaming step without splitting it across parallel worker threads. For parallel multi-core array partitioning across CPU threads, use `runWorker()`.

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
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { transformArray } from './transform.worker.ts';

const factory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    defineWorkerConfig({
      name: 'transform',
      role: 'computation',
      func: transformArray,
    }),
  ),
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

After releasing, the next `runPersistent` call will create a fresh worker instance (requiring a new dataset).

---

## Lifecycle Management (`terminate`, `destroy`, `reset`, `restart`)

`MainWorkerFactory` provides built-in lifecycle management to terminate running workers and clean up browser resources:

### `terminate()` / `destroy()`

Immediately stops all active workers (one-shot tasks, pipelines, reducers) and releases all cached persistent workers:

```ts
// Stop all active threads and release persistent workers
factory.terminate();
// or
factory.destroy(); // Alias for terminate()

console.log(factory.isTerminated); // true
```

After calling `terminate()`, any attempt to run workers on the factory instance will immediately reject.

### `reset()` / `restart()`

Terminates all active/persistent worker instances and restores the factory to an active state (`isTerminated = false`), allowing new worker instances to be initiated cleanly:

```ts
// Stop existing workers and reset factory state
factory.reset(); // or factory.restart()

console.log(factory.isTerminated); // false

// Factory is ready to initiate fresh worker instances again
const settled = await factory.runWorker('sum', { srcData: [1, 2, 3] });
```

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
