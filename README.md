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
      partition: true, // split the array across threads
      maxConcurrency: 4,
      retries: 2,
    }),
  ),
});

// Fully type-safe: 'sum' autocompletes and srcData is type-checked.
// Each thread sums its slice; the reducer adds the partial sums together.
const { data, succeeded } = await factory.runWorker('sum', {
  srcData: [1, 2, 3, 4, 5],
  reducer: (partialSums) => partialSums.reduce((acc, n) => acc + n, 0),
});

console.log(data); // 15
```

> Without `partition: true`, the array is **not** split: each of the
> `maxConcurrency` threads runs the whole input, and you get one result per
> thread (here `[15, 15, 15, 15]`). See [Partitioning](#partitioning).

Using React? Create the factory once, outside render — see [Using with React](#using-with-react) and the [React + MUI example](examples/react-mui).

---

## WorkerConfig Options

| Option           | Type           | Default                               | Description                                                                                                              |
| ---------------- | -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `name`           | `string`       | —                                     | Unique identifier used to call the worker                                                                                |
| `role`           | `string`       | —                                     | Logical grouping label                                                                                                   |
| `func`           | `Function`     | —                                     | The exported worker function to run (optional if `createWorker` is provided)                                             |
| `createWorker`   | `() => Worker` | —                                     | Worker factory function `() => new Worker(new URL(...))` for Webpack 5 / Vite static analysis                            |
| `maxConcurrency` | `number`       | `navigator.`<br>`hardwareConcurrency` | Max parallel worker instances — defaults to the number of logical CPU cores reported by the browser                      |
| `retries`        | `number`       | `2`                                   | How many times to retry a failed shard before marking it as rejected (a failing shard runs `retries + 1` times)          |
| `partition`      | `boolean`      | `false`                               | Split array input across multiple workers automatically. Without it, every thread runs the full input                    |
| `memory`         | `boolean`      | `false`                               | Also keep the merged result in the MemoryWorker; the result carries a `__memory_ref__` (see [Memory refs](#memory-refs)) |
| `memoryOnly`     | `boolean`      | `false`                               | Keep the merged result **only** in the MemoryWorker; the result has no `data`, just the `__memory_ref__`                 |

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

**v1.0.0** turned `workerkit` into a modern, type-friendly library and streamlined the worker execution model. If you are upgrading from **v0.14.1**, review the concrete breaking changes and migration steps below. (Upgrading from v1.0.0? See [Upgrading from v1.0.0](#upgrading-from-v100).)

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

> **Note:** The reducer runs inside a worker thread, so it must be self-contained — it cannot reference variables from the outer scope. A reducer that does is run on the main thread instead, and an error is logged.

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
- The first step can start from a stored result instead of `srcData` by passing `__memory_ref__` (see [Memory refs](#memory-refs)).

### When a step fails

If a step throws, or its worker hits an uncaught error, `pipeline()` rejects with an `Error` carrying that step's message and stops every worker in the pipeline. Pipeline steps are not retried — `retries` applies to `runWorker` only.

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

### Overlapping calls

Calls may overlap — for example a slider that calls `runPersistent` on every input event. Each call is matched to its own reply, so every call resolves with the result for its own `config`, whatever order they finish in:

```ts
const [doubled, tripled] = await Promise.all([
  factory.runPersistent('transform', { config: { multiplier: 2 } }),
  factory.runPersistent('transform', { config: { multiplier: 3 } }),
]);
```

### Errors

Failed calls reject with an `Error`:

- The first call must include a `dataset` — any value except `undefined`, so `null` counts. Otherwise it rejects with `No dataset cached. Provide a dataset on the first call.`
- If your function throws, only that call rejects, with the thrown message. The worker and its cached dataset are kept.
- If the worker hits an uncaught error after it has answered at least one call (for example an exception thrown inside a timer), every call waiting on it rejects. The worker and its cached dataset are kept.
- If the worker fails before answering any call (for example a bundled worker whose module throws while loading), the waiting calls reject and the worker is discarded. The next call starts a fresh worker, so it must send the `dataset` again.

### Bundled workers (`createWorker` + `defineWorker`)

Workers written with `defineWorker` support `runPersistent` too — the dataset is cached inside the worker and your function receives `{ data, config }`:

```ts
// scale.worker.ts
import { defineWorker } from '@offmain/workerkit/define-worker';

export default defineWorker(
  ({ data, config }: { data: number[]; config: { mult: number } }) =>
    data.map((n) => n * config.mult),
);
```

### Memory management

The cached dataset lives in worker memory until `release()` is called. For large datasets, always call `release()` when you're done to free the memory.

After releasing, calls still waiting on that worker reject, and the next `runPersistent` call creates a fresh worker instance (requiring a new dataset).

---

## Memory refs

Each factory has a MemoryWorker: a thread that holds data for the other workers. Data stored there is identified by a ref, and workers started from that ref read the data — or, with `partition`, only their part of it — straight from the MemoryWorker. Your main thread passes the data once instead of once per worker, per call or per retry.

### Pass data once with `setMemory`

```ts
const ref = await factory.setMemory(rows); // crosses from the main thread once

// Every call below reads `rows` from the MemoryWorker — none of them sends it again
const { data: totals } = await factory.runWorker('sumByCategory', {
  __memory_ref__: ref, // partition: true → each thread reads only its part
});
const { data: outliers } = await factory.runWorker('findOutliers', {
  __memory_ref__: ref,
});
const { data: report } = await factory.pipeline([
  { worker: 'clean', __memory_ref__: ref },
  { worker: 'summarize' },
]);

await factory.deleteMemory(ref); // or `deleteMemory: true` on the last call
```

`ArrayBuffer`s in the data are moved to the MemoryWorker, not copied, so they are empty in your code afterwards. `factory.getMemory(ref)` reads a stored value back to the main thread.

### Keep a worker's result with `memory` / `memoryOnly`

A worker's result can stay in the MemoryWorker and be handed to the next worker by ref, so a large intermediate dataset never has to come back to your code:

```ts
const factory = new MainWorkerFactory({
  workers: defineWorkerConfigs(
    defineWorkerConfig({
      name: 'generate',
      role: 'io',
      func: generate,
      memoryOnly: true,
    }),
    defineWorkerConfig({ name: 'analyse', role: 'compute', func: analyse }),
  ),
});

// memoryOnly: the result has no `data` — only a ref to it
const { __memory_ref__: ref } = await factory.runWorker('generate', {
  srcData: { count: 250_000 },
});

// The next worker reads the stored data itself; deleteMemory frees it afterwards
const { data } = await factory.runWorker('analyse', {
  __memory_ref__: ref,
  deleteMemory: true,
});
```

| Config             | `runWorker` returns                                         |
| ------------------ | ----------------------------------------------------------- |
| neither            | `{ data, succeeded, failed, errors }`                       |
| `memory: true`     | `{ data, succeeded, failed, errors, __memory_ref__ }`       |
| `memoryOnly: true` | `{ succeeded, failed, errors, __memory_ref__ }` — no `data` |

### What crosses the main thread

| Call                                      | Data passing through the main thread                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `srcData` with `partition` (N threads)    | One copy in total — each thread gets its part                                                             |
| `srcData` without `partition` (N threads) | One copy — stored in the MemoryWorker, which each thread reads                                            |
| `__memory_ref__`                          | None — each thread reads its input (or its part) itself                                                   |
| `pipeline` starting from `__memory_ref__` | None — the first step reads it itself                                                                     |
| Results                                   | Each thread's result goes to the MemoryWorker; only the merged result comes back (none with `memoryOnly`) |

- Your function receives the stored data as `data`, as if it had been passed as `srcData`. It never sees `__memory_ref__` or `deleteMemory` in its parameters.
- Bundled workers (`createWorker`) written with `defineWorker` read refs themselves from their second call on (their first reply tells the factory they can). Hand-written workers can't read from the MemoryWorker, so the factory sends them the data, as before.
- With `memory` or `memoryOnly`, the reducer worker writes the merged result into the MemoryWorker itself.
- With `deleteMemory: true`, the ref is freed once every worker of the call has read it — for a pipeline, when the pipeline finishes.
- TypeScript types a `memoryOnly` worker's result as `MemoryRefResult`, which has no `data`. That needs the literal `memoryOnly: true` in the config; if the value comes from a `boolean` variable, the result is typed as `CollectedResult` even though `data` may be missing.

Inspect and free stored data with `factory.getMemoryStats()`, `factory.deleteMemory(ref)` and `factory.clearMemory()`. Stored data belongs to the factory's MemoryWorker, so `terminate()` and `reset()` discard it.

---

## Lifecycle Management (`terminate`, `destroy`, `reset`, `restart`)

`MainWorkerFactory` provides built-in lifecycle management to terminate running workers and clean up browser resources.

Each factory owns one long-lived thread, its **MemoryWorker**, which holds stored results. It starts on the factory's first call (creating a factory starts no thread) and runs until `terminate()`. The workers that do the computing are short-lived: they stop when their call finishes. Persistent workers run until `release()` or `terminate()`. If a factory is garbage-collected without `terminate()`, its MemoryWorker is stopped too — but collection can happen late, so terminate factories you are done with (see [Using with React](#using-with-react)).

### `terminate()` / `destroy()`

Immediately stops all active workers (one-shot tasks, pipelines, reducers) and releases all cached persistent workers:

```ts
// Stop all active threads and release persistent workers
factory.terminate();
// or
factory.destroy(); // Alias for terminate()

console.log(factory.isTerminated); // true
```

After calling `terminate()`, any attempt to run workers on the factory instance will immediately reject. Calls that were still running when you called it (`runWorker`, `pipeline`, `runPersistent`) reject too, with `MainWorkerFactory has been terminated` — handle that rejection if you terminate while work is in flight (for example when a component unmounts). `getMemoryStats()`, `deleteMemory()` and `clearMemory()` also reject until you call `reset()`.

### `reset()` / `restart()`

Terminates all active/persistent worker instances, clears stored memory refs, and restores the factory to an active state (`isTerminated = false`) with a fresh MemoryWorker, so new calls work normally. Calls that were running before the reset reject and never retry into the new state:

```ts
// Stop existing workers and reset factory state
factory.reset(); // or factory.restart()

console.log(factory.isTerminated); // false

// Factory is ready to initiate fresh worker instances again
const { data } = await factory.runWorker('sum', { srcData: [1, 2, 3] });
```

---

## Using with React

Create a factory **once** — not during render. A factory created in a component body, or in `useMemo`, is created again on re-renders, on remounts and twice under StrictMode, and every one that gets used keeps a MemoryWorker thread running until it is garbage-collected.

The simplest setup is one factory for the whole app, at module level:

```ts
// workers/factory.ts
export const workerFactory = new MainWorkerFactory({ workers });

// Vite re-runs this module after an edit: stop the old factory's threads.
if (import.meta.hot) import.meta.hot.dispose(() => workerFactory.terminate());
```

A factory that belongs to one component is created in an effect and terminated in its cleanup:

```tsx
type Factory = MainWorkerFactory<typeof workers>;

const [factory, setFactory] = useState<Factory | null>(null);
useEffect(() => {
  const created = new MainWorkerFactory({ workers });
  setFactory(created);
  return () => created.terminate();
}, []);
```

Calls can't be cancelled one by one — `terminate()` stops the whole factory. When a component no longer needs a result (it unmounted, or its inputs changed), ignore the result when it arrives, and free anything it stored with `deleteMemory`. Release persistent workers (`release()`) when the component that uses them unmounts.

**Full example:** [`examples/react-mui`](examples/react-mui) — 100,000 rows generated, transformed and summarized in workers with partitioning, concurrency and memory refs, shown in a virtualized MUI list. Run it with `pnpm install && pnpm example:react` — it runs against your working copy of the library and picks up every change you save under `src/`.

---

## Errors and logging

How each call reports a worker failure:

| Call            | When a worker fails                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `runWorker`     | Retries the shard (`retries`, default `2`). A shard that still fails is counted in `failed` and listed in `errors` — the call itself resolves. |
| `pipeline`      | Rejects with an `Error` carrying the failing step's message and stops every worker in the pipeline. Steps are not retried.                     |
| `runPersistent` | Rejects with an `Error` (see [Persistent Workers → Errors](#errors)).                                                                          |

Any call also rejects with `MainWorkerFactory has been terminated` if the factory is terminated while it runs (see [Lifecycle Management](#lifecycle-management-terminate-destroy-reset-restart)).

Each entry in a `runWorker` result's `errors` is a `PromiseRejectedResult`. Its `reason.failedResult.message` holds the worker's error message, and `reason.workerConfigs.data` the parameters the shard was called with:

```ts
const { data, failed, errors } = await factory.runWorker('sum', {
  srcData: largeArray,
});
for (const { reason } of errors) {
  console.warn(`shard ${reason.index} failed:`, reason.failedResult?.message);
}
```

Worker errors are handled by the library, so the browser does not report them as uncaught errors on the page. They are reported through the factory's logger instead, which writes to the console with a `[WorkerManager]` prefix. Choose how much it logs with `logLevel`:

```ts
const factory = new MainWorkerFactory({ workers, logLevel: 'info' });
factory.logger.setLevel('silent'); // or change it later
```

| `logLevel`          | What is logged                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `'silent'`          | Nothing                                                                                                                                    |
| `'error'` (default) | Failures: a shard that failed after all its retries, a failed pipeline step, a failed persistent call, a reducer that failed in its worker |
| `'info'`            | Also every failed attempt that will be retried, and every merge that falls back to the main thread                                         |
| `'verbose'`         | Also debug detail, such as workers being created                                                                                           |

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

Bundled worker scripts are loaded with `createWorker` instead of being imported, so they need no named export. The rule allows `export default defineWorker(...)` (and a bare `defineWorker(fn)` call), and hand-written scripts that listen for messages themselves (`self.onmessage = ...` or `self.addEventListener('message', ...)`).

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

## Upgrading from v1.0.0

The only API removed is the `dependencies` option, which never did anything. Most changes affect failures and shutdown, where several calls that used to hang now settle. Check the rows that apply to your code:

| Area                                                                      | v1.0.0                                                                     | Now                                                                                                        | What to do                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Calls still running when you call `terminate()` or `reset()`              | Never settled                                                              | Reject with `MainWorkerFactory has been terminated`                                                        | Catch that rejection where you terminate during work, for example on unmount                        |
| `getMemoryStats()`, `deleteMemory()`, `clearMemory()` after `terminate()` | Never settled                                                              | Reject until you call `reset()`                                                                            | Don't call them on a terminated factory                                                             |
| Calls after `reset()` / `restart()`                                       | Never settled                                                              | Work normally, with a fresh MemoryWorker                                                                   | Nothing; memory refs from before the reset are gone                                                 |
| `memoryOnly: true`                                                        | The result also contained `data`                                           | The result has no `data` and is typed `MemoryRefResult`                                                    | Pass `__memory_ref__` on, or use `memory: true` if you need the data                                |
| Overlapping `runPersistent()` calls                                       | Could receive another call's result, or never settle                       | Each call gets its own result                                                                              | Nothing                                                                                             |
| A `runPersistent()` call whose worker crashes                             | Rejected with an `ErrorEvent`                                              | Rejects with an `Error`                                                                                    | Read `error.message`; don't check `instanceof ErrorEvent`                                           |
| `release()` while calls are waiting                                       | The waiting calls never settled                                            | They reject                                                                                                | Nothing                                                                                             |
| A persistent worker that fails before answering any call                  | Kept, so later calls never settled                                         | Discarded; the next call starts a fresh worker                                                             | Send the `dataset` again on the next call                                                           |
| `runPersistent()` with `dataset: null`                                    | Treated as "no dataset"                                                    | Cached like any other value                                                                                | Leave `dataset` out instead of passing `null`                                                       |
| A `pipeline()` step whose worker crashes                                  | Rejected with an `ErrorEvent`                                              | Rejects with an `Error` carrying the step's message                                                        | Read `error.message`                                                                                |
| A `pipeline()` started from `__memory_ref__` with `deleteMemory: true`    | The ref was deleted before the pipeline ran                                | Deleted when the pipeline finishes (the first step reads it while running)                                 | Nothing                                                                                             |
| `__memory_ref__` and `deleteMemory` parameters                            | `__memory_ref__` reached the worker function when `srcData` was also given | Never passed to the worker function                                                                        | Don't read them inside workers                                                                      |
| Worker errors in the browser console                                      | Also reported as uncaught errors on the page                               | Reported only through the factory logger                                                                   | Use `logLevel: 'info'` to also see retried failures (see [Errors and logging](#errors-and-logging)) |
| `dependencies` config option                                              | Accepted, but did nothing                                                  | Removed. Objects typed `WorkerConfig` report it as an unknown property; elsewhere it is ignored, as before | Delete it (to run workers in sequence, use `pipeline()`)                                            |

Fixed, with no action needed:

- A single-step `pipeline()` works with arrow functions (it failed with a `SyntaxError`) and can start from a `__memory_ref__` (the ref was ignored).
- Workers written with `defineWorker` cache the dataset under `runPersistent`.
- A persistent worker that returns its cached typed array, or part of it, no longer empties its cache.
- Inputs or results holding two views of the same buffer no longer fail with `DataCloneError`.
- A hand-written worker that replies with a bare value (neither `ok` nor `data`) from a pipeline's last step or a persistent call now gets that value back; v1.0.0 returned `undefined`. Replies shaped `{ data }` or `{ ok: true, data }` work as before.
- `workerPlugin.configs.recommended` loads (in v1.0.0 it crashed ESLint), and `worker-exportable` accepts `export default defineWorker(...)` and hand-written worker scripts loaded with `createWorker`.
- `terminate()` also stops reducer workers that are merging results.
- Workers started from a `__memory_ref__` read their input — or, with `partition`, their part of it — straight from the MemoryWorker. v1.0.0 read the data back to the main thread and posted it to every worker. The same input sent to several threads (no `partition`) now leaves the main thread once instead of once per thread. See [What crosses the main thread](#what-crosses-the-main-thread).
- A typed array (or other buffer) sent to several threads without `partition` reaches all of them; in v1.0.0 only the first thread got it and the others failed.
- New: `factory.setMemory(data)` stores data in the MemoryWorker once and returns a ref for any number of calls; `factory.getMemory(ref)` reads it back.
- Creating a factory no longer starts a thread: its MemoryWorker starts on the first call. A factory that is garbage-collected without `terminate()` has its MemoryWorker stopped. Factories created and then dropped — for example during React renders — no longer leave threads running for the life of the page.
- Workers running the same function share one `blob:` URL. v1.0.0 created a new URL, holding a copy of the worker's script, for every worker it started, and never freed them.
- With `memory: true`, the merged result is stored by the reducer worker directly instead of being copied through the main thread.

---

## License

MIT
