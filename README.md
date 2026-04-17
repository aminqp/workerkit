# workerkit

A lightweight TypeScript library for running functions in Web Workers with support for partitioning, retries, and concurrency control — all without the boilerplate.

Instead of manually creating worker scripts and wiring up `postMessage` / `onmessage`, you write plain exported functions and hand them to `MainWorkerFactory`. The library serialises them into Blob workers, manages a pool per function, handles retries on failure, and merges results back on the main thread.

---

## Installation

```bash
npm install workerkit
# or
pnpm add workerkit
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
import { MainWorkerFactory } from 'workerkit';
import { sum } from './sum.worker.ts';

const factory = new MainWorkerFactory(initiator, {
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

const result = await factory.runWorker('sum', { srcData: [1, 2, 3, 4, 5] });
const { data } = await factory.collectResults(result);

console.log(data); // 15
```

---

## WorkerConfig Options

| Option           | Type       | Default                         | Description                                                                                         |
| ---------------- | ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `name`           | `string`   | —                               | Unique identifier used to call the worker                                                           |
| `role`           | `string`   | —                               | Logical grouping label                                                                              |
| `func`           | `Function` | —                               | The exported worker function to run                                                                 |
| `maxConcurrency` | `number`   | `navigator.hardwareConcurrency` | Max parallel worker instances — defaults to the number of logical CPU cores reported by the browser |
| `retries`        | `number`   | `0`                             | How many times to retry a failed shard                                                              |
| `partition`      | `boolean`  | `false`                         | Split array input across multiple workers automatically                                             |

---

## Partitioning

When `partition: true`, an array passed as `srcData` is automatically split across worker instances and results are merged back.

```ts
const result = await factory.runWorker('sum', {
  srcData: largeArray, // split across workers
});

const { data, succeeded, failed } = await factory.collectResults(result);
```

You can also provide a custom reducer to control how shard results are merged:

```ts
const { data } = await factory.collectResults(result, {
  reducer: (shards) => shards.flat().sort((a, b) => b.score - a.score),
});
```

---

## ESLint Plugin

The package ships with two ESLint rules to catch common worker mistakes at lint time.

### Setup

```js
// eslint.config.js
import workerPlugin from 'workerkit/eslint-plugin';

export default [...workerPlugin.configs.recommended];
```

This applies both rules to all `*.worker.ts` and `*.worker.js` files.

### Rules

#### `no-dom-in-worker`

Flags usage of browser main-thread-only APIs that are unavailable inside Web Workers — things like `document`, `window`, `localStorage`, `alert`, DOM constructors, etc.

```ts
// sum.worker.ts ❌ — will be flagged
export function sum({ data }: MessageEvent) {
  document.title = 'working...'; // Error: 'document' is not available inside Web Workers
  return data.reduce((a: number, b: number) => a + b, 0);
}
```

```ts
// sum.worker.ts ✅
export function sum({ data }: MessageEvent) {
  return data.reduce((a: number, b: number) => a + b, 0);
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
import noDomInWorker from 'workerkit/eslint-rules/no-dom-in-worker';
import workerExportable from 'workerkit/eslint-rules/worker-exportable';

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
