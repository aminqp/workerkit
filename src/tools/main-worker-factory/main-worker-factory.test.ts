import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import MainWorkerFactory from './main-worker-factory';
import { WorkerConfig } from './types';

// ---------------------------------------------------------------------------
// Mock WorkerFactory so no real Worker / Blob / URL.createObjectURL is needed
// ---------------------------------------------------------------------------

const { mockMemoryStore } = vi.hoisted(() => ({
  mockMemoryStore: new Map<string, unknown>(),
}));

vi.mock('../memory-store/memory-worker-proxy', () => {
  return {
    MemoryWorkerProxy: class MockProxy {
      store = mockMemoryStore;
      allocateWorkerPort = vi.fn().mockResolvedValue({} as MessagePort);
      async set(data: unknown, ref?: string) {
        const actualRef = ref || 'mem_' + crypto.randomUUID();
        this.store.set(actualRef, data);
        return actualRef;
      }
      async get(ref: string) {
        return this.store.get(ref);
      }
      async has(ref: string) {
        return this.store.has(ref);
      }
      async delete(ref: string) {
        return this.store.delete(ref);
      }
      async clear() {
        this.store.clear();
      }
      async stats() {
        return { count: this.store.size, refs: Array.from(this.store.keys()) };
      }
      terminate = vi.fn().mockImplementation(() => {
        this.store.clear();
      });
    },
  };
});

type RawWorkerMock = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage: Mock<any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  terminate: Mock<any, any>;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  isMemoryWorker: boolean;
  /** helper: simulate a successful response */
  respond: (data: unknown) => void;
  /** helper: simulate an error */
  fail: (error?: unknown) => void;
};

const workerInstances: RawWorkerMock[] = [];

function createMockWorker(): RawWorkerMock {
  console.log('createMockWorker called!');
  const mock: RawWorkerMock = {
    postMessage: vi.fn((data) => {
      if (data && data.__init_memory_port__) {
        mock.isMemoryWorker = true;
      }
    }),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    isMemoryWorker: false,
    respond(data: unknown) {
      console.log('worker.respond called with', data);

      // Some error tests pass { ok: false, error: '...' }
      if (
        typeof data === 'object' &&
        data !== null &&
        (data as Record<string, unknown>).ok === false
      ) {
        this.onmessage?.({ data } as MessageEvent);
        return;
      }

      if (
        this.isMemoryWorker &&
        typeof data === 'object' &&
        data !== null &&
        !('__memory_ref__' in data)
      ) {
        // Simulate a memory worker storing data and returning a ref
        const ref = 'mem_' + crypto.randomUUID();
        mockMemoryStore.set(ref, data);
        this.onmessage?.({ data: { __memory_ref__: ref } } as MessageEvent);
      } else {
        this.onmessage?.({ data } as MessageEvent);
      }
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
        console.log('MockWorkerFactory constructor called!');
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
  console.log(
    'autoRespond called! workerInstances length:',
    workerInstances.length,
  );
  // flush microtasks so workers are registered, then respond
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log(
    'autoRespond after flush. workerInstances length:',
    workerInstances.length,
  );
  workerInstances.forEach((worker) => {
    if (!worker.terminate.mock.calls.length) worker.respond(data);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockMemoryStore.clear();
  workerInstances.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    value: 4,
    configurable: true,
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

    expect(results.succeeded).toBe(1);
    expect(results.failed).toBe(0);
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
      (worker) => worker.postMessage.mock.calls[1][0],
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    workerInstances[0].fail();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerInstances[1]?.respond({ ok: true });

    const results = await promise;
    expect(results.succeeded).toBe(1);
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    workerInstances[0].fail();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerInstances[1]?.fail();

    const results = await promise;
    expect(results.failed).toBe(1);
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    workerInstances[0].fail();

    const results = await promise;
    expect(results.failed).toBe(1);
    const reason = results.errors[0].reason;
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    workerInstances[0].respond({ ok: false, error: 'logical failure' });

    const results = await promise;
    expect(results.failed).toBe(1);
    const reason = results.errors[0].reason;
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

    await new Promise((resolve) => setTimeout(resolve, 0));
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
    expect(settled.succeeded + settled.failed).toBe(0);
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

    const promise = factory.runWorker('w1', {
      srcData: 'x',
      autoCollect: false,
    });
    await autoRespond();
    const results = await promise;

    const indices = (
      results.data as unknown as {
        results: Array<{ value: { index: number } }>;
      }
    ).results.map((r) => r.value.index);

    expect(indices).toEqual([0, 1, 2]);
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

    expect(results.succeeded).toBe(1);
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

    await new Promise((resolve) => setTimeout(resolve, 0));
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

    await new Promise((resolve) => setTimeout(resolve, 0));
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
      await new Promise((resolve) => setTimeout(resolve, 0));

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
      await new Promise((resolve) => setTimeout(resolve, 0));

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
        { name: 'w1', role: 'compute', func: noop, maxConcurrency: 1 },
      ]);

      factory.runPersistent('w1', { config: {} });
      await new Promise((resolve) => setTimeout(resolve, 0));

      factory.reset();

      expect(factory.isTerminated).toBe(false);

      const promise = factory.runWorker('w1', { srcData: { test: 1 } });
      await autoRespond({ data: 'ok-after-reset' });
      const res = await promise;

      expect(res.succeeded).toBe(1);
    });

    it('clears memory store upon termination', async () => {
      const factory = makeFactory([]);
      await factory['_memoryWorkerProxy'].set('some-data', 'test-ref');
      factory['_memoryStore'].register('test-ref');

      expect((await factory.getMemoryStats()).count).toBe(1);

      factory.terminate();

      expect((await factory.getMemoryStats()).count).toBe(0);
    });

    it('clears memory store upon reset', async () => {
      const factory = makeFactory([]);
      await factory['_memoryWorkerProxy'].set('some-data', 'test-ref');
      factory['_memoryStore'].register('test-ref');

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

      const promise = factory.runWorker('w1', {
        srcData: { count: 10 },
        autoCollect: false,
      });
      await autoRespond({ numbers: [1, 2, 3] });
      const res = await promise;

      const payload = (
        res.data as unknown as {
          results: Array<{
            value: {
              successResult: {
                data: { __memory_ref__?: string; data?: unknown };
              };
            };
          }>;
        }
      ).results[0].value.successResult.data;

      expect(payload.__memory_ref__).toMatch(/^mem_/);
      expect(payload.data).toBeUndefined();

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

      const promise = factory.runWorker('w1', {
        srcData: { count: 10 },
        autoCollect: false,
      });
      await autoRespond({ numbers: [100, 200] });
      const res = await promise;

      const payload = (
        res.data as unknown as {
          results: Array<{
            value: {
              successResult: {
                data: { __memory_ref__?: string; data?: unknown };
              };
            };
          }>;
        }
      ).results[0].value.successResult.data;

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
      const ref = prodRes.__memory_ref__ as string;

      // Step 2: Run consumer passing __memory_ref__
      const consPromise = factory.runWorker('consumer', {
        __memory_ref__: ref,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Check worker instance received resolved dataset as srcData (data field in payload)
      const consumerWorkerInstance =
        workerInstances[workerInstances.length - 1];
      expect(consumerWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ items: ['a', 'b', 'c'] }],
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

      const testRef = 'test-ref';
      await factory['_memoryWorkerProxy'].set('test', testRef);
      factory['_memoryStore'].register(testRef);
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
      await factory['_memoryWorkerProxy'].set('existing', 'existing-ref');
      factory['_memoryStore'].register('existing-ref');

      const promise = factory.runWorker('w1', { srcData: {} });
      await new Promise((resolve) => setTimeout(resolve, 0));

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

      const promise = factory.runWorker('w1', {
        srcData: {},
        autoCollect: false,
      });
      await autoRespond({ num: 1 });
      const res = await promise;

      const payload = (
        res.data as unknown as {
          results: Array<{
            value: {
              successResult: {
                data: { __memory_ref__?: string; data?: unknown };
              };
            };
          }>;
        }
      ).results[0].value.successResult.data;

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
      const ref = prodRes.__memory_ref__ as string;

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
      const ref = prodRes.__memory_ref__ as string;

      // Consumer passes BOTH srcData AND __memory_ref__
      const consPromise = factory.runWorker('consumer', {
        srcData: { explicit: 'newData' },
        __memory_ref__: ref,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

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
      const ref = res.__memory_ref__ as string;

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
        autoCollect: false,
      });
      await autoRespond([10, 20]); // Both shards respond with [10, 20]
      const prodRes = await prodPromise;

      // Expect single ref returned (not an array of 2 duplicate refs)
      const ref = (
        prodRes.data as unknown as {
          results: Array<{
            value: { successResult: { data: { __memory_ref__: string } } };
          }>;
        }
      ).results[0].value.successResult.data.__memory_ref__;
      expect(ref).toMatch(/^mem_/);

      // 2. Run consumer on 2 threads passing the ref
      // autoRespond responds to ALL 2 live threads at once with [100, 200]
      const consPromise = factory.runWorker('partitionedConsumer', {
        __memory_ref__: ref,
        deleteMemory: true,
      });
      await autoRespond([100, 200]); // Both shards respond with [100, 200]
      const consRes = await consPromise;

      // Both shards returned [100, 200] → flat merge is [100, 200, 100, 200]
      expect(consRes.data).toEqual([100, 200, 100, 200]);
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
        autoCollect: false,
      });
      // autoRespond responds to ALL live workers at once — both shards get [10, 20]
      await autoRespond([10, 20]);
      const prodRes = await prodPromise;

      const payload = (
        prodRes.data as unknown as {
          results: Array<{
            value: {
              successResult: {
                data: { __memory_ref__?: string; data?: unknown };
              };
            };
          }>;
        }
      ).results[0].value.successResult.data;
      expect(payload).toEqual({
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
      const ref = prodRes.__memory_ref__ as string;

      const consPromise = factory.runWorker('consumer', {
        __memory_ref__: ref,
        deleteMemory: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const consumerWorkerInstance =
        workerInstances[workerInstances.length - 1];
      const sentPayload = consumerWorkerInstance.postMessage.mock.calls[1][0];

      expect(sentPayload.__memory_ref__).toBeUndefined();
      expect(sentPayload.deleteMemory).toBeUndefined();
      expect(sentPayload.data).toEqual([{ numbers: [1, 2] }]);

      await autoRespond({ ok: true });
      await consPromise;
    });

    it('resolves __memory_ref__ on pipeline step 0', async () => {
      const factory = makeFactory([
        { name: 'step1', role: 'transform', func: noop, maxConcurrency: 1 },
        { name: 'step2', role: 'transform', func: noop, maxConcurrency: 1 },
      ]);

      // Populate memory store manually
      const testRef = 'test-ref-step1';
      await factory['_memoryWorkerProxy'].set(['item1', 'item2'], testRef);
      factory['_memoryStore'].register(testRef);

      void factory.pipeline([
        { worker: 'step1', __memory_ref__: testRef, deleteMemory: true },
        { worker: 'step2' },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 0));

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

      const testRef = 'test-ref-step2';
      await factory['_memoryWorkerProxy'].set('step2-data', testRef);
      factory['_memoryStore'].register(testRef);

      void factory.pipeline([
        { worker: 'step1', srcData: {} },
        { worker: 'step2', __memory_ref__: testRef, deleteMemory: true },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 0));

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
