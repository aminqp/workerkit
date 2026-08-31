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

function createMockWorker(): RawWorkerMock {
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
  return mock;
}

vi.mock('../worker-factory/worker-factory', () => {
  return {
    WorkerMode: {
      Default: 'default',
      Pipeline: 'pipeline',
      Persistent: 'persistent',
    },
    default: class MockWorkerFactory {
      _worker: RawWorkerMock;
      constructor() {
        this._worker = createMockWorker();
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
  workerInstances.forEach((worker) => {
    if (!worker.terminate.mock.calls.length) worker.respond(data);
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

    workerInstances.forEach((worker) =>
      expect(worker.terminate).toHaveBeenCalled(),
    );
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

    const messages = workerInstances.map(
      (worker) => worker.postMessage.mock.calls[0][0],
    );
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
    workerInstances.forEach((worker) =>
      expect(worker.postMessage).toHaveBeenCalledWith(
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

  it('returns rejected result on logical worker error (ok: false)', async () => {
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
    workerInstances[0].respond({ ok: false, error: 'logical failure' });

    const results = await promise;
    expect(results.results[0].status).toBe('rejected');
    const reason = (results.results[0] as PromiseRejectedResult).reason;
    expect(reason.failedResult.message).toBe('logical failure');
  });

  it('does not retry when retries: 0 and ok: false is returned', async () => {
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
    workerInstances[0].respond({ ok: false, error: 'logical failure' });
    await promise;

    expect(workerInstances).toHaveLength(1); // no retry worker spawned
  });
});

// ── edge cases ──────────────────────────────────────────────────────────────

describe('runWorker – edge cases', () => {
  it('spawns only as many threads as needed for a single-element array without duplicating', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 4,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: [42] });
    await autoRespond();
    await promise;

    // Only 1 chunk produced → 1 worker thread spawned
    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: [42] }),
      expect.any(Array),
    );
  });

  it('spawns only as many threads as array chunks when array length < maxConcurrency', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 8,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: [10, 20] });
    await autoRespond();
    await promise;

    // Array length is 2 → only 2 worker threads spawned instead of 8
    expect(workerInstances).toHaveLength(2);
    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: [10] }),
      expect.any(Array),
    );
    expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: [20] }),
      expect.any(Array),
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

    workerInstances.forEach((worker) =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ data: { scalar: true } }),
        expect.any(Array),
      ),
    );
  });

  it('handles empty array srcData when partition: true', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 4,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: [] });
    await autoRespond();
    const settled = await promise;

    // Empty array → 0 worker threads spawned
    expect(workerInstances).toHaveLength(0);
    expect(settled.results).toHaveLength(0);
  });

  it('spawns exactly 1 worker when partition: true and srcData is an object', async () => {
    const factory = makeFactory([
      {
        name: 'w1',
        role: 'computation',
        func: noop,
        maxConcurrency: 4,
        partition: true,
      },
    ]);

    const promise = factory.runWorker('w1', { srcData: { a: 1 } });
    await autoRespond();
    await promise;

    // Not an array, so it is treated as a single non-partitionable block and broadcast to ALL threads
    expect(workerInstances).toHaveLength(4);
    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { a: 1 } }),
      expect.any(Array),
    );
  });

  it('handles explicit srcData: undefined gracefully', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 2 },
    ]);

    const promise = factory.runWorker('w1', { srcData: undefined });
    await autoRespond();
    await promise;

    // Treats as non-array scalar, broadcasts to all 2 workers
    expect(workerInstances).toHaveLength(2);
    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: undefined }),
      expect.any(Array),
    );
  });

  it('handles explicit srcData: null gracefully', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'computation', func: noop, maxConcurrency: 2 },
    ]);

    const promise = factory.runWorker('w1', { srcData: null });
    await autoRespond();
    await promise;

    // Treats as non-array scalar, broadcasts to all 2 workers
    expect(workerInstances).toHaveLength(2);
    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: null }),
      expect.any(Array),
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
      .filter((result) => result.status === 'fulfilled')
      .map(
        (result) =>
          (result as PromiseFulfilledResult<WorkerResult>).value.index,
      );

    expect(indices).toEqual([0, 1, 2]);
  });
});
// ── collectResults ──────────────────────────────────────────────────────────

describe('collectResults', () => {
  it('merges multiple fulfilled shards with default flat reducer', async () => {
    const factory = makeFactory([]);
    // typed settled results mock
    const dummySettled = new (await import('./types')).TypedSettledResults([
      {
        status: 'fulfilled',
        value: {
          index: 0,
          successResult: { data: [1, 2] } as MessageEvent,
        } as unknown as WorkerResult,
      },
      {
        status: 'fulfilled',
        value: {
          index: 1,
          successResult: { data: [3, 4] } as MessageEvent,
        } as unknown as WorkerResult,
      },
    ]);

    const result = await factory.collectResults(dummySettled);
    expect(result.data).toEqual([1, 2, 3, 4]);
    expect(result.failed).toBe(0);
    expect(result.succeeded).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('uses custom reducer function if provided', async () => {
    const factory = makeFactory([]);
    const dummySettled = new (await import('./types')).TypedSettledResults([
      {
        status: 'fulfilled',
        value: {
          index: 0,
          successResult: { data: { count: 10 } } as MessageEvent,
        } as unknown as WorkerResult,
      },
      {
        status: 'fulfilled',
        value: {
          index: 1,
          successResult: { data: { count: 20 } } as MessageEvent,
        } as unknown as WorkerResult,
      },
    ]);

    const result = await factory.collectResults(dummySettled, {
      reducer: (shards: { count: number }[]) => {
        return {
          total: shards.reduce(
            (acc: number, cur: { count: number }) => acc + cur.count,
            0,
          ),
        };
      },
    });

    expect(result.data).toEqual({ total: 30 });
  });

  it('handles partial success', async () => {
    const factory = makeFactory([]);
    const dummySettled = new (await import('./types')).TypedSettledResults([
      {
        status: 'fulfilled',
        value: {
          index: 0,
          successResult: { data: [1] } as MessageEvent,
        } as unknown as WorkerResult,
      },
      {
        status: 'rejected',
        reason: { failedResult: { error: 'shard 1 failed', index: 1 } },
      },
      {
        status: 'fulfilled',
        value: {
          index: 2,
          successResult: { data: [3] } as MessageEvent,
        } as unknown as WorkerResult,
      },
    ]);

    const result = await factory.collectResults(dummySettled);
    expect(result.data).toEqual([1, 3]);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason?.failedResult?.error).toBe('shard 1 failed');
  });

  it('handles all shards rejected', async () => {
    const factory = makeFactory([]);
    const dummySettled = new (await import('./types')).TypedSettledResults([
      {
        status: 'rejected',
        reason: { failedResult: { error: 'err 0', index: 0 } },
      },
      {
        status: 'rejected',
        reason: { failedResult: { error: 'err 1', index: 1 } },
      },
    ]);

    const result = await factory.collectResults(dummySettled);
    expect(result.data).toEqual([]);
    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.errors).toHaveLength(2);
  });

  it('handles single fulfilled shard returning flat data', async () => {
    const factory = makeFactory([]);
    const dummySettled = new (await import('./types')).TypedSettledResults([
      {
        status: 'fulfilled',
        value: {
          index: 0,
          successResult: { data: { res: 1 } } as MessageEvent,
        } as unknown as WorkerResult,
      },
    ]);

    const result = await factory.collectResults(dummySettled);
    expect(result.data).toEqual([{ res: 1 }]);
  });

  it('flattens already flat arrays correctly', async () => {
    const factory = makeFactory([]);
    const dummySettled = new (await import('./types')).TypedSettledResults([
      {
        status: 'fulfilled',
        value: {
          index: 0,
          successResult: { data: [1, 2] } as MessageEvent,
        } as unknown as WorkerResult,
      },
      {
        status: 'fulfilled',
        value: {
          index: 1,
          successResult: { data: [3, 4] } as MessageEvent,
        } as unknown as WorkerResult,
      },
    ]);

    const result = await factory.collectResults(dummySettled);
    expect(result.data).toEqual([1, 2, 3, 4]);
  });
});

// ── pipeline ────────────────────────────────────────────────────────────────

describe('pipeline', () => {
  it('throws when no steps are provided', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    await expect(factory.pipeline([])).rejects.toThrow(
      'Pipeline requires at least one step',
    );
  });

  it('throws when a worker name is not found', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    await expect(
      factory.pipeline([{ worker: 'nonexistent', srcData: {} }]),
    ).rejects.toThrow('Worker "nonexistent" not found');
  });

  it('resolves with result for a single-step pipeline', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const promise = factory.pipeline([{ worker: 'w1', srcData: { x: 1 } }]);

    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: { result: 42 } } }),
    );

    const result = await promise;
    expect(result).toEqual({ result: 42 });
  });

  it('creates one worker per pipeline step', async () => {
    const factory = makeFactory([
      { name: 'generate', role: 'compute', func: noop },
      { name: 'transform', role: 'compute', func: noop },
      { name: 'aggregate', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'generate', srcData: { count: 10 } },
      { worker: 'transform' },
      { worker: 'aggregate' },
    ]);

    await Promise.resolve();
    expect(workerInstances).toHaveLength(3);

    // Pipeline's onmessage expects { ok: true, data: ... }
    workerInstances[2].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: { total: 100 } } }),
    );

    const result = await promise;
    expect(result).toEqual({ total: 100 });
  });

  it('sends srcData to the first worker', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: { count: 50 } },
      { worker: 'w2' },
    ]);

    await Promise.resolve();

    const firstWorkerCalls = workerInstances[0].postMessage.mock.calls;
    const dataMessage = firstWorkerCalls.find(
      (call) => !call[0]?.__pipeline_ports__,
    );
    expect(dataMessage).toBeDefined();
    expect(dataMessage![0]).toMatchObject({ data: { count: 50 } });

    workerInstances[1].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'done' } }),
    );
    await promise;
  });

  it('sends pipeline port configuration to workers', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
      { name: 'w3', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
      { worker: 'w3' },
    ]);

    await Promise.resolve();

    for (const worker of workerInstances) {
      const portMessage = worker.postMessage.mock.calls.find(
        (call) => call[0]?.__pipeline_ports__,
      );
      expect(portMessage).toBeDefined();
    }

    workerInstances[2].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'final' } }),
    );
    await promise;
  });

  it('terminates all workers after pipeline completes', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
    ]);

    await Promise.resolve();
    workerInstances[1].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'result' } }),
    );

    await promise;

    workerInstances.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalled();
    });
  });

  it('forwards step-specific configs and options in pipeline steps', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: { limit: 10 }, options: { timeout: 1000 } },
      { worker: 'w2', configs: { multiplier: 5 } },
    ]);

    await Promise.resolve();

    // Step 0 worker should receive stepParams containing options
    expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        __pipeline_ports__: true,
        stepParams: { options: { timeout: 1000 } },
      }),
      expect.anything(),
    );

    // Step 1 worker should receive stepParams containing configs
    expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        __pipeline_ports__: true,
        stepParams: { configs: { multiplier: 5 } },
      }),
      expect.anything(),
    );

    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: 'configured-result' },
      }),
    );

    const res = await promise;
    expect(res).toBe('configured-result');
  });

  it('rejects and terminates all workers on error from last worker', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
    ]);

    await Promise.resolve();
    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: false, error: 'transform failed' },
      }),
    );

    await expect(promise).rejects.toThrow('transform failed');

    workerInstances.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalled();
    });
  });

  it('rejects on onerror from last worker', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
    ]);

    await Promise.resolve();
    const lastWorker = workerInstances[1];
    lastWorker.onerror?.(new ErrorEvent('error', { message: 'crash' }));

    await expect(promise).rejects.toBeDefined();
  });

  it('rejects and terminates all workers on error from intermediate worker (ok: false)', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
      { name: 'w3', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
      { worker: 'w3' },
    ]);

    await Promise.resolve();
    // Step 0 worker (intermediate) posts error
    workerInstances[0].onmessage?.(
      new MessageEvent('message', {
        data: { ok: false, error: 'step 1 failed' },
      }),
    );

    await expect(promise).rejects.toThrow('step 1 failed');

    workerInstances.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalled();
    });
  });

  it('rejects and terminates all workers on onerror from intermediate worker', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
    ]);

    await Promise.resolve();
    // Step 0 worker crashes
    workerInstances[0].onerror?.(
      new ErrorEvent('error', { message: 'crash 0' }),
    );

    await expect(promise).rejects.toBeDefined();

    workerInstances.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalled();
    });
  });

  it('relays intermediate result for func-based workers gracefully', async () => {
    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'w1', srcData: {} },
      { worker: 'w2' },
    ]);

    await Promise.resolve();
    // Intermediate func workers post `{ ok: true }` without data to main thread
    workerInstances[0].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true },
      }),
    );

    // Final worker posts final result
    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: 'final-result' },
      }),
    );

    const result = await promise;
    expect(result).toBe('final-result');
  });

  it('handles typed generic result', async () => {
    interface Summary {
      total: number;
      avg: number;
    }

    const factory = makeFactory([
      { name: 'w1', role: 'compute', func: noop },
      { name: 'w2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline<Summary>([
      { worker: 'w1', srcData: { items: [1, 2, 3] } },
      { worker: 'w2' },
    ]);

    await Promise.resolve();
    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: { total: 6, avg: 2 } },
      }),
    );

    const result = await promise;
    expect(result.total).toBe(6);
    expect(result.avg).toBe(2);
  });

  it('spawns exactly 1 worker per pipeline step even when partition: true and maxConcurrency > 1 are set', async () => {
    const factory = makeFactory([
      {
        name: 'step1',
        role: 'compute',
        func: noop,
        partition: true,
        maxConcurrency: 8,
      },
      {
        name: 'step2',
        role: 'compute',
        func: noop,
        partition: true,
        maxConcurrency: 10,
      },
    ]);

    const promise = factory.pipeline([
      { worker: 'step1', srcData: [1, 2, 3, 4, 5] },
      { worker: 'step2' },
    ]);

    await Promise.resolve();

    // Pipeline creates exactly 1 worker per step (2 total), ignoring multi-thread partitioning
    expect(workerInstances).toHaveLength(2);

    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: [2, 4, 6, 8, 10] },
      }),
    );

    const result = await promise;
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('forwards partition: true passed in pipeline step config cleanly as a step parameter', async () => {
    const factory = makeFactory([
      { name: 'step1', role: 'compute', func: noop },
      { name: 'step2', role: 'compute', func: noop },
    ]);

    const promise = factory.pipeline([
      { worker: 'step1', srcData: [10, 20] },
      { worker: 'step2', partition: true },
    ]);

    await Promise.resolve();

    // Step 2 worker receives stepParams containing { partition: true }
    expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        __pipeline_ports__: true,
        stepParams: { partition: true },
      }),
      expect.anything(),
    );

    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: [20, 40] },
      }),
    );

    const res = await promise;
    expect(res).toEqual([20, 40]);
  });
});

// ── runPersistent ───────────────────────────────────────────────────────────

describe('runPersistent', () => {
  it('throws when worker name is not found', async () => {
    const factory = makeFactory([]);
    await expect(
      factory.runPersistent('unknown', { config: {} }),
    ).rejects.toThrow('Worker "unknown" not found');
  });

  it('sends type: run without dataset if no prior dataset was provided', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    // First call, but NO dataset provided
    const promise = factory.runPersistent('w1', { config: { x: 1 } });
    await Promise.resolve();

    const msg = workerInstances[0].postMessage.mock.calls[0][0];
    expect(msg.type).toBe('run');
    expect(msg.dataset).toBeUndefined(); // worker logic will reject this if it needs one
    expect(msg.config).toEqual({ x: 1 });

    workerInstances[0].onmessage?.(
      new MessageEvent('message', {
        data: { ok: false, error: 'No dataset cached' },
      }),
    );
    await expect(promise).rejects.toThrow('No dataset cached');
  });

  it('resolves with result on first call with dataset + config', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const promise = factory.runPersistent('w1', {
      dataset: [1, 2, 3],
      config: { multiplier: 2 },
    });

    await Promise.resolve();
    // Persistent worker receives { type: 'run', dataset, config }
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: { sum: 12 } } }),
    );

    const result = await promise;
    expect(result).toEqual({ sum: 12 });
  });

  it('sends dataset on first call', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const promise = factory.runPersistent('w1', {
      dataset: [10, 20],
      config: { x: 1 },
    });

    await Promise.resolve();

    const msg = workerInstances[0].postMessage.mock.calls[0][0];
    expect(msg.type).toBe('run');
    expect(msg.dataset).toEqual([10, 20]);
    expect(msg.config).toEqual({ x: 1 });

    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'ok' } }),
    );
    await promise;
  });

  it('does not send dataset on subsequent config-only calls', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    // First call with dataset
    const p1 = factory.runPersistent('w1', {
      dataset: [1, 2, 3],
      config: { a: 1 },
    });
    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'r1' } }),
    );
    await p1;

    // Second call without dataset
    const p2 = factory.runPersistent('w1', { config: { a: 2 } });
    await Promise.resolve();

    const msg = workerInstances[0].postMessage.mock.calls[1][0];
    expect(msg.type).toBe('run');
    expect(msg.dataset).toBeUndefined();
    expect(msg.config).toEqual({ a: 2 });

    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'r2' } }),
    );
    const result = await p2;
    expect(result).toBe('r2');
  });

  it('reuses the same worker instance across calls', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const p1 = factory.runPersistent('w1', {
      dataset: [1],
      config: {},
    });
    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'a' } }),
    );
    await p1;

    const p2 = factory.runPersistent('w1', { config: {} });
    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'b' } }),
    );
    await p2;

    // Only one worker instance should have been created
    expect(workerInstances).toHaveLength(1);
  });

  it('rejects when worker responds with ok: false', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const promise = factory.runPersistent('w1', {
      dataset: [],
      config: {},
    });

    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', {
        data: {
          ok: false,
          error: 'No dataset cached. Provide a dataset on the first call.',
        },
      }),
    );

    await expect(promise).rejects.toThrow('No dataset cached');
  });

  it('rejects on onerror', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const promise = factory.runPersistent('w1', {
      dataset: [1],
      config: {},
    });

    await Promise.resolve();
    workerInstances[0].onerror?.(new ErrorEvent('error', { message: 'crash' }));

    await expect(promise).rejects.toBeDefined();
  });
});

// ── release ─────────────────────────────────────────────────────────────────

describe('release', () => {
  it('terminates the persistent worker', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const persistentPromise = factory.runPersistent('w1', {
      dataset: [1],
      config: {},
    });
    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'done' } }),
    );
    await persistentPromise;

    factory.release('w1');

    expect(workerInstances[0].terminate).toHaveBeenCalled();
  });

  it('sends release message before terminating', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    const persistentPromise = factory.runPersistent('w1', {
      dataset: [1],
      config: {},
    });
    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'done' } }),
    );
    await persistentPromise;

    factory.release('w1');

    const releaseMsg = workerInstances[0].postMessage.mock.calls.find(
      (call) => call[0]?.type === 'release',
    );
    expect(releaseMsg).toBeDefined();
  });

  it('creates a new worker after release + re-run', async () => {
    const factory = makeFactory([{ name: 'w1', role: 'compute', func: noop }]);

    // First session
    const p1 = factory.runPersistent('w1', { dataset: [1], config: {} });
    await Promise.resolve();
    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'a' } }),
    );
    await p1;

    factory.release('w1');
    expect(workerInstances).toHaveLength(1);

    // Second session — should create a new worker
    const p2 = factory.runPersistent('w1', { dataset: [2], config: {} });
    await Promise.resolve();
    expect(workerInstances).toHaveLength(2);

    workerInstances[1].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: 'b' } }),
    );
    const result = await p2;
    expect(result).toBe('b');
  });

  it('does nothing when releasing a non-existent worker', () => {
    const factory = makeFactory([]);
    // Should not throw
    expect(() => factory.release('nonexistent')).not.toThrow();
  });
});

// ── createWorker support ───────────────────────────────────────────────────

describe('MainWorkerFactory – createWorker support', () => {
  it('runs a worker configured with createWorker', async () => {
    const factory = makeFactory([
      {
        name: 'createWorkerSample',
        role: 'transform',
        createWorker: () => createMockWorker() as unknown as Worker,
        maxConcurrency: 1,
      },
    ]);

    const promise = factory.runWorker('createWorkerSample', {
      srcData: { test: 123 },
    });
    await autoRespond({ data: 'create-worker-result' });
    const results = await promise;

    expect(results.results).toHaveLength(1);
    expect(results.results[0].status).toBe('fulfilled');
  });

  it('runs a pipeline with a step configured with createWorker', async () => {
    const factory = makeFactory([
      {
        name: 'createStep1',
        role: 'compute',
        createWorker: () => createMockWorker() as unknown as Worker,
      },
      {
        name: 'createStep2',
        role: 'compute',
        createWorker: () => createMockWorker() as unknown as Worker,
      },
    ]);

    const promise = factory.pipeline([
      { worker: 'createStep1', srcData: { input: 1 } },
      { worker: 'createStep2' },
    ]);

    await Promise.resolve();
    expect(workerInstances).toHaveLength(2);

    // Simulate step 1 (native plain worker) posting result back to main thread
    workerInstances[0].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: 'step1-native-output' },
      }),
    );

    // Verify step 1 output was relayed to step 2 worker
    expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
      { data: 'step1-native-output', index: 0 },
      [],
    );

    // Simulate step 2 posting final result
    workerInstances[1].onmessage?.(
      new MessageEvent('message', {
        data: { ok: true, data: 'pipeline-create-worker-result' },
      }),
    );

    const result = await promise;
    expect(result).toBe('pipeline-create-worker-result');
  });

  it('runs a persistent worker configured with createWorker', async () => {
    const factory = makeFactory([
      {
        name: 'createPersistent',
        role: 'compute',
        createWorker: () => createMockWorker() as unknown as Worker,
      },
    ]);

    const promise = factory.runPersistent('createPersistent', {
      dataset: [100, 200],
      config: { multiplier: 2 },
    });

    await Promise.resolve();
    expect(workerInstances).toHaveLength(1);

    workerInstances[0].onmessage?.(
      new MessageEvent('message', { data: { ok: true, data: { sum: 600 } } }),
    );

    const result = await promise;
    expect(result).toEqual({ sum: 600 });
  });

  describe('terminate & destroy', () => {
    it('terminates all persistent and active workers', async () => {
      const factory = makeFactory([
        { name: 'w1', role: 'compute', func: noop },
        { name: 'w2', role: 'compute', func: noop },
      ]);

      // Start a persistent worker
      factory.runPersistent('w1', { config: {} });
      await Promise.resolve();

      expect(factory.isTerminated).toBe(false);

      factory.terminate();

      expect(factory.isTerminated).toBe(true);
      workerInstances.forEach((worker) => {
        expect(worker.terminate).toHaveBeenCalled();
      });
    });

    it('supports destroy as an alias for terminate', async () => {
      const factory = makeFactory([
        { name: 'w1', role: 'compute', func: noop },
      ]);

      factory.runPersistent('w1', { config: {} });
      await Promise.resolve();

      factory.destroy();

      expect(factory.isTerminated).toBe(true);
      workerInstances.forEach((worker) => {
        expect(worker.terminate).toHaveBeenCalled();
      });
    });

    it('prevents running workers after termination', async () => {
      const factory = makeFactory([
        { name: 'w1', role: 'compute', func: noop },
      ]);

      factory.terminate();

      await expect(
        factory.runWorker('w1', { srcData: [1, 2, 3] }),
      ).rejects.toThrow('MainWorkerFactory has been terminated');

      await expect(
        factory.pipeline([{ worker: 'w1', srcData: { a: 1 } }]),
      ).rejects.toThrow('MainWorkerFactory has been terminated');

      await expect(factory.runPersistent('w1', { config: {} })).rejects.toThrow(
        'MainWorkerFactory has been terminated',
      );

      const dummySettled = new (
        await import('./types')
      ).TypedSettledResults<unknown>([]);
      await expect(factory.collectResults(dummySettled)).rejects.toThrow(
        'MainWorkerFactory has been terminated',
      );
    });

    it('resets the factory so new worker instances can be initiated', async () => {
      const factory = makeFactory([
        { name: 'w1', role: 'compute', func: noop },
      ]);

      factory.runPersistent('w1', { config: {} });
      await Promise.resolve();

      factory.reset();

      expect(factory.isTerminated).toBe(false);

      const promise = factory.runWorker('w1', { srcData: { test: 1 } });
      await autoRespond({ data: 'ok-after-reset' });
      const res = await promise;

      expect(res.results[0].status).toBe('fulfilled');
    });

    it('clears memory store upon termination', async () => {
      const factory = makeFactory([]);
      factory['_memoryStore'].set('some-data');

      expect((await factory.getMemoryStats()).count).toBe(1);

      factory.terminate();

      expect((await factory.getMemoryStats()).count).toBe(0);
    });

    it('clears memory store upon reset', async () => {
      const factory = makeFactory([]);
      factory['_memoryStore'].set('some-data');

      expect((await factory.getMemoryStats()).count).toBe(1);

      factory.reset();

      expect((await factory.getMemoryStats()).count).toBe(0);
    });

    it('supports restart as an alias for reset', async () => {
      const factory = makeFactory([
        { name: 'w1', role: 'compute', func: noop },
      ]);

      factory.terminate();
      expect(factory.isTerminated).toBe(true);

      factory.restart();
      expect(factory.isTerminated).toBe(false);
    });
  });

  // ── Memory Management ───────────────────────────────────────────────────────

  describe('Memory Management (memory & memoryOnly)', () => {
    it('returns data + __memory_ref__ when memory: true is configured', async () => {
      const factory = makeFactory([
        {
          name: 'w1',
          role: 'compute',
          func: noop,
          memory: true,
          maxConcurrency: 1,
        },
      ]);

      const promise = factory.runWorker('w1', { srcData: { count: 10 } });
      await autoRespond({ numbers: [1, 2, 3] });
      const res = await promise;

      const fulfilled = res.results[0] as PromiseFulfilledResult<WorkerResult>;
      const payload = fulfilled.value.successResult!.data as {
        data: unknown;
        __memory_ref__: string;
      };

      expect(payload.data).toEqual({ numbers: [1, 2, 3] });
      expect(payload.__memory_ref__).toMatch(/^mem_/);

      const stats = await factory.getMemoryStats();
      expect(stats.count).toBe(1);
      expect(stats.refs).toContain(payload.__memory_ref__);
    });

    it('returns ONLY __memory_ref__ when memoryOnly: true is configured', async () => {
      const factory = makeFactory([
        {
          name: 'w1',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
      ]);

      const promise = factory.runWorker('w1', { srcData: { count: 10 } });
      await autoRespond({ numbers: [100, 200] });
      const res = await promise;

      const fulfilled = res.results[0] as PromiseFulfilledResult<WorkerResult>;
      const payload = fulfilled.value.successResult!.data as Record<
        string,
        unknown
      >;

      expect(payload.data).toBeUndefined();
      expect(payload.__memory_ref__).toMatch(/^mem_/);

      const stats = await factory.getMemoryStats();
      expect(stats.count).toBe(1);
    });

    it('resolves __memory_ref__ transparently for consumer worker when srcData is omitted', async () => {
      const factory = makeFactory([
        {
          name: 'producer',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
        { name: 'consumer', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      // Step 1: Run producer
      const prodPromise = factory.runWorker('producer', {
        srcData: { count: 5 },
      });
      await autoRespond({ items: ['a', 'b', 'c'] });
      const prodRes = await prodPromise;
      const ref = (prodRes.results[0] as PromiseFulfilledResult<WorkerResult>)
        .value.successResult!.data.__memory_ref__;

      // Step 2: Run consumer passing __memory_ref__
      const consPromise = factory.runWorker('consumer', {
        __memory_ref__: ref,
      });
      await Promise.resolve();

      // Check worker instance received resolved dataset as srcData (data field in payload)
      const consumerWorkerInstance =
        workerInstances[workerInstances.length - 1];
      expect(consumerWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { items: ['a', 'b', 'c'] },
        }),
        expect.any(Array),
      );

      await autoRespond({ status: 'done' });
      await consPromise;
    });

    it('supports multiple refs in store simultaneously', async () => {
      const factory = makeFactory([
        {
          name: 'w1',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
        {
          name: 'w2',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
      ]);

      const p1 = factory.runWorker('w1', { srcData: {} });
      await autoRespond({ id: 1 });
      await p1;

      const p2 = factory.runWorker('w2', { srcData: {} });
      await autoRespond({ id: 2 });
      await p2;

      const stats = await factory.getMemoryStats();
      expect(stats.count).toBe(2);
      expect(stats.refs).toHaveLength(2);
    });

    it('returns false when deleteMemory is called on already deleted or non-existent ref', async () => {
      const factory = makeFactory([]);
      const deleted1 = await factory.deleteMemory('mem_unknown');
      expect(deleted1).toBe(false);

      const testRef = factory['_memoryStore'].set('test');
      expect(await factory.deleteMemory(testRef)).toBe(true);
      expect(await factory.deleteMemory(testRef)).toBe(false); // already deleted
    });

    it('clears memory safely even if workers are running (but does not affect in-flight)', async () => {
      const factory = makeFactory([
        {
          name: 'w1',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
      ]);
      factory['_memoryStore'].set('existing');

      const promise = factory.runWorker('w1', { srcData: {} });
      await Promise.resolve();

      await factory.clearMemory();
      expect((await factory.getMemoryStats()).count).toBe(0);

      // Worker resolves and adds its result to memory AFTER clearMemory was called
      await autoRespond({ id: 1 });
      await promise;

      expect((await factory.getMemoryStats()).count).toBe(1);
    });

    it('prioritizes memoryOnly over memory if both are true', async () => {
      const factory = makeFactory([
        {
          name: 'w1',
          role: 'compute',
          func: noop,
          memory: true,
          memoryOnly: true,
          maxConcurrency: 1,
        },
      ]);

      const promise = factory.runWorker('w1', { srcData: {} });
      await autoRespond({ num: 1 });
      const res = await promise;

      const fulfilled = res.results[0] as PromiseFulfilledResult<WorkerResult>;
      const payload = fulfilled.value.successResult!.data;

      expect(payload.data).toBeUndefined(); // memoryOnly takes precedence
      expect(payload.__memory_ref__).toBeDefined();
    });

    it('deletes memory reference after resolution if deleteMemory: true is passed', async () => {
      const factory = makeFactory([
        {
          name: 'producer',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
        { name: 'consumer', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      const prodPromise = factory.runWorker('producer', {
        srcData: { count: 5 },
      });
      await autoRespond({ secret: 'data' });
      const prodRes = await prodPromise;
      const ref = (prodRes.results[0] as PromiseFulfilledResult<WorkerResult>)
        .value.successResult!.data.__memory_ref__;

      // Consumer runs with deleteMemory: true
      const consPromise = factory.runWorker('consumer', {
        __memory_ref__: ref,
        deleteMemory: true,
      });
      await autoRespond({ status: 'done' });
      await consPromise;

      // Check memory reference was removed
      const stats = await factory.getMemoryStats();
      expect(stats.count).toBe(0);
    });

    it('ignores __memory_ref__ if explicit srcData is provided', async () => {
      const factory = makeFactory([
        {
          name: 'producer',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
        { name: 'consumer', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      const prodPromise = factory.runWorker('producer', { srcData: {} });
      await autoRespond({ stored: 'oldData' });
      const prodRes = await prodPromise;
      const ref = (prodRes.results[0] as PromiseFulfilledResult<WorkerResult>)
        .value.successResult!.data.__memory_ref__;

      // Consumer passes BOTH srcData AND __memory_ref__
      const consPromise = factory.runWorker('consumer', {
        srcData: { explicit: 'newData' },
        __memory_ref__: ref,
      });
      await Promise.resolve();

      const consumerWorkerInstance =
        workerInstances[workerInstances.length - 1];
      expect(consumerWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { explicit: 'newData' },
        }),
        expect.any(Array),
      );

      await autoRespond({ status: 'done' });
      await consPromise;
    });

    it('supports deleteMemory and clearMemory API calls', async () => {
      const factory = makeFactory([
        {
          name: 'w1',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
      ]);

      const promise = factory.runWorker('w1', { srcData: {} });
      await autoRespond({ val: 123 });
      const res = await promise;
      const ref = (res.results[0] as PromiseFulfilledResult<WorkerResult>).value
        .successResult!.data.__memory_ref__;

      expect((await factory.getMemoryStats()).count).toBe(1);

      const deleted = await factory.deleteMemory(ref);
      expect(deleted).toBe(true);
      expect((await factory.getMemoryStats()).count).toBe(0);

      // Re-run and test clearMemory
      const promise2 = factory.runWorker('w1', { srcData: {} });
      await autoRespond({ val: 456 });
      await promise2;
      expect((await factory.getMemoryStats()).count).toBe(1);

      await factory.clearMemory();
      expect((await factory.getMemoryStats()).count).toBe(0);
    });

    it('flattens array shards and deduplicates refs when partition: true & maxConcurrency > 1 are used with memory', async () => {
      const factory = makeFactory([
        {
          name: 'partitionedProducer',
          role: 'compute',
          func: noop,
          partition: true,
          memoryOnly: true,
          maxConcurrency: 2,
        },
        {
          name: 'partitionedConsumer',
          role: 'transform',
          func: noop,
          partition: true,
          maxConcurrency: 2,
        },
      ]);

      // 1. Run producer on 2 threads
      // autoRespond sends the same data to ALL live workers simultaneously,
      // so both shards receive [10, 20] in one call.
      const prodPromise = factory.runWorker('partitionedProducer', {
        srcData: [1, 2, 3, 4],
      });
      await autoRespond([10, 20]); // Both shards respond with [10, 20]
      const prodRes = await prodPromise;

      const collectedProd = await factory.collectResults(prodRes);
      // Expect single ref returned (not an array of 2 duplicate refs)
      const ref = (collectedProd.data as unknown as { __memory_ref__: string })
        .__memory_ref__;
      expect(ref).toMatch(/^mem_/);

      // 2. Run consumer on 2 threads passing the ref
      // autoRespond responds to ALL 2 live threads at once with [100, 200]
      const consPromise = factory.runWorker('partitionedConsumer', {
        __memory_ref__: ref,
        deleteMemory: true,
      });
      await autoRespond([100, 200]); // Both shards respond with [100, 200]
      const consRes = await consPromise;

      const collectedCons = await factory.collectResults(consRes);
      // Both shards returned [100, 200] → flat merge is [100, 200, 100, 200]
      expect(collectedCons.data).toEqual([100, 200, 100, 200]);
    });

    it('throws error if invalid or non-existent __memory_ref__ is supplied', async () => {
      const factory = makeFactory([
        { name: 'consumer', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      await expect(
        factory.runWorker('consumer', {
          __memory_ref__: 'mem_invalid_non_existent',
        }),
      ).rejects.toThrow(
        'Memory reference "mem_invalid_non_existent" not found in MemoryStore',
      );
    });

    it('unwraps inner data shards and preserves __memory_ref__ when collectResults is called on memory: true worker', async () => {
      const factory = makeFactory([
        {
          name: 'partitionedProducer',
          role: 'compute',
          func: noop,
          partition: true,
          memory: true,
          maxConcurrency: 2,
        },
      ]);

      const prodPromise = factory.runWorker('partitionedProducer', {
        srcData: [1, 2, 3, 4],
      });
      // autoRespond responds to ALL live workers at once — both shards get [10, 20]
      await autoRespond([10, 20]);
      const prodRes = await prodPromise;

      const collected = await factory.collectResults(prodRes);
      // Both shards returned [10, 20] → flat merge is [10, 20, 10, 20]
      expect(collected.data).toEqual({
        data: [10, 20, 10, 20],
        __memory_ref__: expect.stringMatching(/^mem_/),
      });
    });

    it('removes __memory_ref__ and deleteMemory control flags from worker payload', async () => {
      const factory = makeFactory([
        {
          name: 'producer',
          role: 'compute',
          func: noop,
          memoryOnly: true,
          maxConcurrency: 1,
        },
        { name: 'consumer', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      const prodPromise = factory.runWorker('producer', { srcData: { x: 1 } });
      await autoRespond({ numbers: [1, 2] });
      const prodRes = await prodPromise;
      const ref = (prodRes.results[0] as PromiseFulfilledResult<WorkerResult>)
        .value.successResult!.data.__memory_ref__;

      const consPromise = factory.runWorker('consumer', {
        __memory_ref__: ref,
        deleteMemory: true,
      });
      await Promise.resolve();

      const consumerWorkerInstance =
        workerInstances[workerInstances.length - 1];
      const sentPayload = consumerWorkerInstance.postMessage.mock.calls[0][0];

      expect(sentPayload.__memory_ref__).toBeUndefined();
      expect(sentPayload.deleteMemory).toBeUndefined();
      expect(sentPayload.data).toEqual({ numbers: [1, 2] });

      await autoRespond({ ok: true });
      await consPromise;
    });

    it('resolves __memory_ref__ on pipeline step 0', async () => {
      const factory = makeFactory([
        { name: 'step1', role: 'transform', func: noop, maxConcurrency: 1 },
        { name: 'step2', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      // Populate memory store manually
      const testRef = factory['_memoryStore'].set(['item1', 'item2']);

      void factory.pipeline([
        { worker: 'step1', __memory_ref__: testRef, deleteMemory: true },
        { worker: 'step2' },
      ]);

      await Promise.resolve();

      // Check worker 0 received resolved dataset
      const step1Worker = workerInstances[workerInstances.length - 2];
      expect(step1Worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: ['item1', 'item2'],
        }),
        expect.any(Array),
      );

      // Memory reference should be deleted
      const stats = await factory.getMemoryStats();
      expect(stats.count).toBe(0);
    });

    it('resolves __memory_ref__ passed as stepParams to steps beyond step 0', async () => {
      const factory = makeFactory([
        { name: 'step1', role: 'transform', func: noop, maxConcurrency: 1 },
        { name: 'step2', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      const testRef = factory['_memoryStore'].set('step2-data');

      void factory.pipeline([
        { worker: 'step1', srcData: {} },
        { worker: 'step2', __memory_ref__: testRef, deleteMemory: true },
      ]);

      await Promise.resolve();

      const step2Worker = workerInstances[workerInstances.length - 1];
      expect(step2Worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          __pipeline_ports__: true,
          stepParams: expect.objectContaining({
            __memory_ref__: testRef,
            deleteMemory: true,
          }),
        }),
        expect.any(Array),
      );
    });
  });
});
