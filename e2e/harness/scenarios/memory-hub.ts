/**
 * The MemoryWorker as a data hub: data enters it once, and workers read
 * their input — or their partition of it — straight from it, so the main
 * thread does not carry the data again for every worker or every call.
 *
 * `meteredTraffic` wraps `Worker` to count the bytes (as JSON) of every
 * message the main thread sends to or receives from any worker.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle } from '../helpers';

interface Row {
  id: number;
  label: string;
  value: number;
}

interface RowStats {
  count: number;
  sum: number;
  first: number;
  last: number;
}

// ── traffic meter ──────────────────────────────────────────────────────────

const meter = { bytes: 0 };
let meterInstalled = false;

const jsonSize = (value: unknown) => {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

/** Counts main-thread ↔ worker traffic from now on (for this page). */
function installMeter() {
  if (meterInstalled) return;
  meterInstalled = true;
  const NativeWorker = window.Worker;
  class MeteredWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener('message', (event) => {
        meter.bytes += jsonSize(event.data);
      });
    }
    postMessage(
      message: unknown,
      transferOrOptions?: Transferable[] | StructuredSerializeOptions,
    ): void {
      meter.bytes += jsonSize(message);
      super.postMessage(
        message,
        transferOrOptions as StructuredSerializeOptions,
      );
    }
  }
  window.Worker = MeteredWorker;
}

/** Runs `action` and returns its result with the main-thread traffic it caused. */
async function metered<T>(action: () => Promise<T>) {
  meter.bytes = 0;
  const result = await action();
  return { result, traffic: meter.bytes };
}

// ── workers ────────────────────────────────────────────────────────────────

const makeRows = ({ data }: { data: { count: number } }): Row[] =>
  Array.from({ length: data.count }, (_, i) => ({
    id: i,
    label: `row number ${i}`,
    value: i % 97,
  }));

const rowStats = ({ data }: { data: Row[] }): RowStats => ({
  count: data.length,
  sum: data.reduce((acc, row) => acc + row.value, 0),
  first: data.length ? data[0].id : -1,
  last: data.length ? data[data.length - 1].id : -1,
});

const sumTyped = ({ data }: { data: Float64Array }) =>
  data.reduce((acc, n) => acc + n, 0);

function createFactory() {
  return new MainWorkerFactory({
    workers: defineWorkerConfigs(
      defineWorkerConfig({
        name: 'makeRows',
        role: 'data',
        func: makeRows,
        maxConcurrency: 1,
        memoryOnly: true,
      }),
      defineWorkerConfig({
        name: 'statsParts',
        role: 'compute',
        func: rowStats,
        partition: true,
        maxConcurrency: 4,
      }),
      defineWorkerConfig({
        name: 'statsWhole',
        role: 'compute',
        func: rowStats,
        maxConcurrency: 3,
      }),
      defineWorkerConfig({
        name: 'sumTyped',
        role: 'compute',
        func: sumTyped,
        maxConcurrency: 3,
        retries: 0,
      }),
      defineWorkerConfig<(p: { data: Row[] }) => RowStats>()({
        name: 'statsBundled',
        role: 'compute',
        createWorker: () =>
          new Worker(
            new URL('../workers/row-stats.worker.ts', import.meta.url),
            {
              type: 'module',
            },
          ),
        partition: true,
        maxConcurrency: 4,
      }),
      defineWorkerConfig<(p: { data: Row[] }) => RowStats>()({
        name: 'statsHandwritten',
        role: 'compute',
        createWorker: () =>
          new Worker(
            new URL('../workers/handwritten-stats.worker.ts', import.meta.url),
            { type: 'module' },
          ),
        partition: true,
        maxConcurrency: 4,
      }),
    ),
  });
}

type Factory = ReturnType<typeof createFactory>;

/** Stores `count` rows in the MemoryWorker without them reaching the main thread. */
async function storeRows(factory: Factory, count: number) {
  const stored = await factory.runWorker('makeRows', {
    srcData: { count },
  });
  if (!stored.__memory_ref__) throw new Error('rows were not stored');
  return stored.__memory_ref__;
}

const datasetBytes = (count: number) => jsonSize(makeRows({ data: { count } }));

// ── scenarios ──────────────────────────────────────────────────────────────

/** Partitioned run from a ref: each worker should read only its own part. */
export async function partitionedFromRef(count: number) {
  installMeter();
  const factory = createFactory();
  const ref = await storeRows(factory, count);
  const { result, traffic } = await metered(() =>
    factory.runWorker('statsParts', {
      __memory_ref__: ref,
      deleteMemory: true,
    }),
  );
  const stored = (await factory.getMemoryStats()).count;
  factory.terminate();
  return {
    shards: result.data,
    failed: result.failed,
    traffic,
    datasetBytes: datasetBytes(count),
    stored,
  };
}

/** Unpartitioned run from a ref on 3 threads: each reads the whole input. */
export async function wholeFromRef(count: number) {
  installMeter();
  const factory = createFactory();
  const ref = await storeRows(factory, count);
  const { result, traffic } = await metered(() =>
    factory.runWorker('statsWhole', { __memory_ref__: ref }),
  );
  factory.terminate();
  return { shards: result.data, traffic, datasetBytes: datasetBytes(count) };
}

/** Same `srcData` for 3 threads: it should leave the main thread once, not 3 times. */
export async function fanOut(count: number) {
  installMeter();
  const factory = createFactory();
  const rows = makeRows({ data: { count } });
  const { result, traffic } = await metered(() =>
    factory.runWorker('statsWhole', { srcData: rows }),
  );
  const stored = (await factory.getMemoryStats()).count;
  factory.terminate();
  return {
    shards: result.data,
    traffic,
    datasetBytes: datasetBytes(count),
    stored,
  };
}

/** A typed array sent to 3 threads (its buffer can only be transferred once). */
export async function fanOutTypedArray() {
  const factory = createFactory();
  const values = Float64Array.from({ length: 1000 }, (_, i) => i);
  const outcome = await settle(
    factory
      .runWorker('sumTyped', { srcData: values })
      .then((r) => ({ data: r.data, failed: r.failed })),
  );
  factory.terminate();
  return outcome;
}

/** A pipeline whose first step starts from a ref. */
export async function pipelineFromRef(count: number) {
  installMeter();
  const factory = createFactory();
  const ref = await storeRows(factory, count);
  const { result, traffic } = await metered(() =>
    factory.pipeline<RowStats>([
      { worker: 'statsWhole', __memory_ref__: ref, deleteMemory: true },
    ]),
  );
  const stored = (await factory.getMemoryStats()).count;
  factory.terminate();
  return {
    stats: result.data,
    traffic,
    datasetBytes: datasetBytes(count),
    stored,
  };
}

/** `setMemory` once, then three different jobs read the same data by ref. */
export async function setMemoryOnce(count: number) {
  installMeter();
  const factory = createFactory();
  const rows = makeRows({ data: { count } });
  const { result, traffic } = await metered(async () => {
    const ref = await factory.setMemory(rows);
    const parts = await factory.runWorker('statsParts', {
      __memory_ref__: ref,
    });
    const whole = await factory.runWorker('statsWhole', {
      __memory_ref__: ref,
    });
    const piped = await factory.pipeline<RowStats>([
      { worker: 'statsWhole', __memory_ref__: ref },
    ]);
    const roundTrip = (await factory.getMemory<Row[]>(ref))?.length;
    await factory.deleteMemory(ref);
    return {
      parts: parts.data,
      whole: whole.data,
      piped: piped.data,
      roundTrip,
    };
  });
  const stored = (await factory.getMemoryStats()).count;
  factory.terminate();
  return { ...result, traffic, datasetBytes: datasetBytes(count), stored };
}

/** A bundled `defineWorker` worker, started from a ref twice. */
export async function bundledFromRef(count: number) {
  installMeter();
  const factory = createFactory();
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const ref = await storeRows(factory, count);
    runs.push(
      await metered(() =>
        factory
          .runWorker('statsBundled', {
            __memory_ref__: ref,
            deleteMemory: true,
          })
          .then((r) => r.data),
      ),
    );
  }
  factory.terminate();
  return { runs, datasetBytes: datasetBytes(count) };
}

/** A hand-written worker can't read from the MemoryWorker: it must still work. */
export async function handwrittenFromRef(count: number) {
  const factory = createFactory();
  const ref = await storeRows(factory, count);
  const outcome = await settle(
    factory
      .runWorker('statsHandwritten', { __memory_ref__: ref })
      .then((r) => r.data),
  );
  factory.terminate();
  return outcome;
}
