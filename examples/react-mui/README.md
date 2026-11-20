# workerkit · React + MUI example

A React 19 app that generates, transforms and summarizes **100,000 transactions in Web Workers** with [`@offmain/workerkit`](../../README.md), and shows them in a virtualized MUI list.

It uses:

- **Partitioning and concurrency** — each step splits its input across up to 8 worker threads (`partition: true`, `maxConcurrency`).
- **Memory refs** — the raw rows never reach the main thread: the generator uses `memoryOnly: true`, so it returns only a `__memory_ref__`, and each transform worker reads its part of the rows straight from the MemoryWorker by that ref. The transform uses `memory: true`, so its result is both returned for the list and kept for the summary worker, which reads it from the MemoryWorker too. Each step frees what it read with `deleteMemory: true`.
- **MUI + react-window** — only the rows on screen are rendered, so all 100,000 scroll smoothly. Filtering runs on the main thread with `useDeferredValue`.

## Run it against your local changes

From the repository root:

```bash
pnpm install
pnpm example:react
```

This builds the library in watch mode and starts the app; Vite prints its URL (usually http://localhost:5173).

The example always uses your working copy of the library: its `@offmain/workerkit` dependency is `workspace:*`, a link to this repository. It goes through the built package in `dist/` — exactly what would be published — so you test what users would get:

- Edit the library under `src/` and save: it rebuilds in under a second, and the open page picks up the new build without a reload.
- Edit the example under `examples/react-mui/src/`: Vite updates it as usual.

Install with pnpm — npm can't resolve `workspace:*`.

### Tests

```bash
pnpm test:e2e:example                                # Chromium, from the repo root
E2E_BROWSERS=chromium,webkit pnpm test:e2e:example   # more browsers
```

They run the app in development mode (with React StrictMode) and as a production build, and check that every row arrives in order, that filtering works, and that after each run exactly **one** worker thread stays alive and nothing stays stored.

### Open it on its own (CodeSandbox, StackBlitz)

Outside this repository there is no local package to link to. Change the dependency to a published version first — for example `"@offmain/workerkit": "^2.0.0"` — and the sandbox installs it from npm. It then runs the **published** code, not your local changes, so publish the changes you want to show first.

## Using workerkit in React: the one rule

Every `MainWorkerFactory` owns a long-lived thread — its MemoryWorker — that runs until you call `terminate()`. So create factories **once**, not during render:

```ts
// ✅ src/workers/factory.ts — one factory for the whole app
export const workerFactory = new MainWorkerFactory({ workers: … });

// Vite re-runs this module after an edit: stop the old factory's threads.
if (import.meta.hot) import.meta.hot.dispose(() => workerFactory.terminate());
```

```tsx
// ✅ A factory that belongs to one component: create it in an effect,
//    terminate it in the cleanup.
const [factory, setFactory] = useState<typeof workerFactory | null>(null);
useEffect(() => {
  const created = new MainWorkerFactory({ workers: … });
  setFactory(created);
  return () => created.terminate();
}, []);
```

```tsx
// ❌ A new factory on every render, remount and StrictMode double render
const factory = new MainWorkerFactory({ workers: … });
const factory = useMemo(() => new MainWorkerFactory({ workers: … }), []);
```

The library limits the damage (a factory starts its thread only when first used, and a factory that is garbage-collected has its thread stopped), but garbage collection may happen late, so don't rely on it.

Calls can't be cancelled one by one — `terminate()` stops the whole factory. When a component no longer needs a result (it unmounted, or the inputs changed), ignore it, as [`useTransactions`](src/hooks/useTransactions.ts) does, and free anything it stored.

## Files

| File                                                                       | What it shows                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`src/workers/transactions.worker.ts`](src/workers/transactions.worker.ts) | The worker functions — self-contained, because they run as source text in a worker |
| [`src/workers/factory.ts`](src/workers/factory.ts)                         | The app's one factory and its three workers                                        |
| [`src/hooks/useTransactions.ts`](src/hooks/useTransactions.ts)             | Running the three steps from an effect, StrictMode-safe                            |
| [`src/hooks/useMemoryHandles.ts`](src/hooks/useMemoryHandles.ts)           | Watching what is stored in the MemoryWorker                                        |
| [`src/components/TransactionList.tsx`](src/components/TransactionList.tsx) | MUI list items virtualized with react-window                                       |
| [`e2e/app.spec.ts`](e2e/app.spec.ts)                                       | Browser tests, including the live-thread count                                     |
