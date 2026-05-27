import { describe, it, expect, vi, beforeEach } from 'vitest';
import MainWorkerFactory from './main-worker-factory';
import { WorkerConfig, WorkerResult } from './types';

// ---------------------------------------------------------------------------
// Mock WorkerFactory so no real Worker / Blob / URL.createObjectURL is needed
// ---------------------------------------------------------------------------

type RawWorkerMock = {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  /** helper: simulate a successful response */
  respond: (data: unknown) => void;
  /** helper: simulate an error */
  fail: (error?: unknown) => void;
};

const workerInstances: RawWorkerMock[] = [];

vi.mock('../worker-factory/worker-factory', () => {
  return {
    default: class MockWorkerFactory {
      _worker: RawWorkerMock;
      constructor() {
        const mock: RawWorkerMock = {
          postMessage: vi.fn(),
          terminate: vi.fn(),
          onmessage: null,
          onerror: null,
          respond(data: unknown) {
            this.onmessage?.({ data } as MessageEvent);
          },
          fail(error: unknown = new Error('worker error')) {
            this.onerror?.(error as ErrorEvent);
          },
        };
        workerInstances.push(mock);
        this._worker = mock;
      }
      get getWorker() {
        return this._worker;
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop: WorkerConfig['func'] = () => {};

function makeFactory(configs: WorkerConfig[]) {
  return new MainWorkerFactory({ workers: configs });
}

/** Auto-respond to all pending worker instances after they are created */
async function autoRespond(data: unknown = { result: 'ok' }) {
  // flush microtasks so workers are registered, then respond
  await Promise.resolve();
  workerInstances.forEach((w) => {
    if (!w.terminate.mock.calls.length) w.respond(data);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  workerInstances.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    value: 4,
    configurable: true,
  });
});

// ── partitionArray ──────────────────────────────────────────────────────────

describe('partitionArray', () => {
  const factory = makeFactory([]);

  it('splits evenly', () => {
    expect(factory.partitionArray([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('distributes remainder across leading chunks', () => {
    expect(factory.partitionArray([1, 2, 3, 4, 5], 3)).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it('returns single chunk when numChunks === 1', () => {
    expect(factory.partitionArray([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
  });

  it('caps chunks to array length', () => {
    const result = factory.partitionArray([1, 2], 10);
    expect(result).toHaveLength(2);
    result.forEach((chunk) => expect(chunk).toHaveLength(1));
  });

  it('returns [] for empty array', () => {
    expect(factory.partitionArray([], 4)).toEqual([]);
  });

  it('throws for numChunks <= 0', () => {
    expect(() => factory.partitionArray([1, 2], 0)).toThrow(
      'numChunks must be positive',
    );
    expect(() => factory.partitionArray([1, 2], -1)).toThrow(
      'numChunks must be positive',
    );
  });

  it('handles single-element array', () => {
    expect(factory.partitionArray([42], 3)).toEqual([[42]]);
  });
});

// ── runWorker – positive ────────────────────────────────────────────────────

describe('runWorker – positive', () => {
  it('resolves with fulfilled results for a known worker', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 1 },
    ]);

    const promise = factory.runWorker('w1', { srcData: { x: 1 } });
    await autoRespond({ value: 42 });
    const results = await promise;

    expect(results.results).toHaveLength(1);
    expect(results.results[0].status).toBe('fulfilled');
  });

  it('passes srcData through to postMessage', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 1 },
    ]);

    const promise = factory.runWorker('w1', { srcData: { key: 'val' } });
    await autoRespond();
    await promise;

    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { key: 'val' } }),
      expect.any(Array),
    );
  });

  it('spawns maxConcurrency workers', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 3 },
    ]);

    const promise = factory.runWorker('w1', { srcData: 'data' });
    await autoRespond();
    await promise;

    expect(workerInstances).toHaveLength(3);
  });

  it('falls back to navigator.hardwareConcurrency when maxConcurrency is unset', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop },
    ]);

    const promise = factory.runWorker('w1', { srcData: 'x' });
    await autoRespond();
    await promise;

    expect(workerInstances).toHaveLength(4); // hardwareConcurrency mocked to 4
  });

  it('terminates each worker after it responds', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 2 },
    ]);

    const promise = factory.runWorker('w1', { srcData: [1, 2] });
    await autoRespond();
    await promise;

    workerInstances.forEach((w) => expect(w.terminate).toHaveBeenCalled());
  });

  it('partitions array data across workers', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 2,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: [1, 2, 3, 4] });
    await autoRespond();
    await promise;

    const messages = workerInstances.map((w) => w.postMessage.mock.calls[0][0]);
    expect(messages[0]).toMatchObject({ data: [1, 2] });
    expect(messages[1]).toMatchObject({ data: [3, 4] });
  });

  it('does not partition when partition flag is false', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 2,
        partition: false,
      },
    ]);

    const arr = [1, 2, 3, 4];
    const promise = factory.runWorker('w1', { srcData: arr });
    await autoRespond();
    await promise;

    // both workers receive the full array
    workerInstances.forEach((w) =>
      expect(w.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ data: arr }),
        expect.any(Array),
      ),
    );
  });

  it('forwards extra params alongside data', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 1 },
    ]);

    const promise = factory.runWorker('w1', {
      srcData: { v: 1 },
      options: { flag: true },
    });
    await autoRespond();
    await promise;

    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ options: { flag: true } }),
      expect.any(Array),
    );
  });
});

// ── runWorker – error / retry ───────────────────────────────────────────────

describe('runWorker – error handling', () => {
  it('rejects when worker name is not found', async () => {
    const factory = makeFactory([]);
    await expect(factory.runWorker('unknown', { srcData: {} })).rejects.toThrow(
      'Worker "unknown" not found',
    );
  });

  it('returns fulfilled after retry on transient failure', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 1,
        retries: 1,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: {} });

    await Promise.resolve();
    workerInstances[0].fail();

    await Promise.resolve();
    await Promise.resolve();
    workerInstances[1]?.respond({ ok: true });

    const results = await promise;
    expect(results.results[0].status).toBe('fulfilled');
  });

  it('returns rejected result after exhausting all retries', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 1,
        retries: 1,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: {} });

    await Promise.resolve();
    workerInstances[0].fail();

    await Promise.resolve();
    await Promise.resolve();
    workerInstances[1]?.fail();

    const results = await promise;
    expect(results.results[0].status).toBe('rejected');
  });

  it('includes failedResult on worker error', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 1,
        retries: 0,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: {} });

    await Promise.resolve();
    workerInstances[0].fail();

    const results = await promise;
    expect(results.results[0].status).toBe('rejected');
    const reason = (results.results[0] as PromiseRejectedResult).reason;
    expect(reason).toHaveProperty('failedResult');
  });
});

// ── edge cases ──────────────────────────────────────────────────────────────

describe('runWorker – edge cases', () => {
  it('does not partition a single-element array', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 2,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: [42] });
    await autoRespond();
    await promise;

    // srcData.length === 1 → shouldPartition is false → full array sent
    workerInstances.forEach((w) =>
      expect(w.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ data: [42] }),
        expect.any(Array),
      ),
    );
  });

  it('handles non-array srcData with partition: true gracefully', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 2,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: { scalar: true } });
    await autoRespond();
    await promise;

    workerInstances.forEach((w) =>
      expect(w.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ data: { scalar: true } }),
        expect.any(Array),
      ),
    );
  });

  it('handles empty array srcData', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 2,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: [] });
    await autoRespond();
    await promise;

    // empty array → shouldPartition false → raw [] forwarded
    workerInstances.forEach((w) =>
      expect(w.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ data: [] }),
        expect.any(Array),
      ),
    );
  });

  it('result includes correct index per worker', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 3 },
    ]);

    const promise = factory.runWorker('w1', { srcData: 'x' });
    await autoRespond();
    const results = await promise;

    const indices = results.results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<WorkerResult>).value.index);

    expect(indices).toEqual([0, 1, 2]);
  });
});
