import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersistentWorkerManager } from './persistent-manager';
import { PersistentManagerContext } from './types';
import { WorkerFactory } from '../worker-factory';

vi.mock('../worker-factory', () => {
  return {
    WorkerFactory: vi.fn(),
    WorkerMode: { Persistent: 'Persistent' },
  };
});

type MockWorker = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: null | ((event: { data: unknown }) => void);
  onerror: null | ((event: Event) => void);
};

/** The `id` of the n-th run request posted to the worker. */
const requestId = (worker: MockWorker, n: number): string =>
  worker.postMessage.mock.calls.filter(
    ([msg]) => (msg as { __persistent__?: string }).__persistent__ === 'run',
  )[n][0].id;

describe('PersistentWorkerManager', () => {
  let context: PersistentManagerContext;
  let controller: AbortController;
  let manager: PersistentWorkerManager;
  let mockWorker: MockWorker;

  const registerWorker = () =>
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn() as unknown as () => void,
      createWorker: undefined,
    });

  const workerCount = () =>
    (manager as unknown as { _persistentWorkers: Map<string, unknown> })[
      '_persistentWorkers'
    ].size;

  beforeEach(() => {
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
    };

    vi.mocked(WorkerFactory).mockImplementation(() => {
      return {
        getWorker: mockWorker,
      } as unknown as WorkerFactory;
    });

    controller = new AbortController();
    context = {
      isTerminated: vi.fn().mockReturnValue(false),
      signal: controller.signal,
      findWorkerByName: vi.fn(),
      trackWorker: vi.fn((worker) => worker),
      terminateWorker: vi.fn(),
      logger: {
        error: vi.fn(),
        verbose: vi.fn(),
      } as unknown as PersistentManagerContext['logger'],
    };

    manager = new PersistentWorkerManager(context);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws an error if the context is terminated', async () => {
    vi.mocked(context.isTerminated).mockReturnValue(true);

    await expect(
      manager.runPersistent('test-worker', { config: {} }),
    ).rejects.toThrow('MainWorkerFactory has been terminated');

    expect(context.logger.error).toHaveBeenCalledWith(
      'Attempted to run persistent worker after MainWorkerFactory was terminated',
    );
  });

  it('throws an error if worker config is not found', async () => {
    vi.mocked(context.findWorkerByName).mockReturnValue(undefined);

    await expect(
      manager.runPersistent('missing-worker', { config: {} }),
    ).rejects.toThrow('Worker "missing-worker" not found');

    expect(context.logger.error).toHaveBeenCalledWith(
      'Persistent worker config not found for worker: "missing-worker"',
    );
  });

  it('lazily instantiates and caches the worker', async () => {
    registerWorker();

    void manager.runPersistent('test-worker', {
      config: { query: 'test' },
      dataset: [1, 2],
    });

    expect(WorkerFactory).toHaveBeenCalledTimes(1);
    expect(context.trackWorker).toHaveBeenCalledWith(mockWorker);
    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      {
        __persistent__: 'run',
        type: 'run',
        id: expect.any(String),
        config: { query: 'test' },
        dataset: [1, 2],
      },
      [],
    );

    // Run again, proving it uses the cached worker instance
    void manager.runPersistent('test-worker', { config: { query: 'test2' } });

    expect(WorkerFactory).toHaveBeenCalledTimes(1);
    expect(mockWorker.postMessage).toHaveBeenLastCalledWith(
      {
        __persistent__: 'run',
        type: 'run',
        id: expect.any(String),
        config: { query: 'test2' },
      },
      [],
    );
  });

  it('resolves with data when worker replies ok', async () => {
    registerWorker();

    const promise = manager.runPersistent('test-worker', { config: {} });
    mockWorker.onmessage?.({
      data: { ok: true, data: 'expected-result', id: requestId(mockWorker, 0) },
    });

    await expect(promise).resolves.toBe('expected-result');
  });

  it('rejects with error when worker replies ok: false', async () => {
    registerWorker();

    const promise = manager.runPersistent('test-worker', { config: {} });
    mockWorker.onmessage?.({
      data: {
        ok: false,
        error: 'worker crashed',
        id: requestId(mockWorker, 0),
      },
    });

    await expect(promise).rejects.toThrow('worker crashed');
    expect(context.logger.error).toHaveBeenCalledWith(
      'Persistent worker test-worker failed',
      'worker crashed',
    );
  });

  describe('overlapping calls', () => {
    it('matches replies to calls by request id, in any order', async () => {
      registerWorker();

      const first = manager.runPersistent('test-worker', { config: 1 });
      const second = manager.runPersistent('test-worker', { config: 2 });

      // The second call finishes first
      mockWorker.onmessage?.({
        data: { ok: true, data: 'second', id: requestId(mockWorker, 1) },
      });
      mockWorker.onmessage?.({
        data: { ok: true, data: 'first', id: requestId(mockWorker, 0) },
      });

      await expect(first).resolves.toBe('first');
      await expect(second).resolves.toBe('second');
    });

    it('answers id-less replies (legacy hand-written workers) in order', async () => {
      registerWorker();

      const first = manager.runPersistent('test-worker', { config: 1 });
      const second = manager.runPersistent('test-worker', { config: 2 });

      mockWorker.onmessage?.({ data: { ok: true, data: 'a' } });
      mockWorker.onmessage?.({ data: { ok: true, data: 'b' } });

      await expect(first).resolves.toBe('a');
      await expect(second).resolves.toBe('b');
    });
  });

  describe('replies from hand-written workers', () => {
    it('unwraps a { data } reply without `ok`, as v1.0.0 did', async () => {
      registerWorker();

      const promise = manager.runPersistent('test-worker', { config: {} });
      mockWorker.onmessage?.({ data: { data: 'expected-result' } });

      await expect(promise).resolves.toBe('expected-result');
    });

    it('returns a reply that has neither `ok` nor `data` as-is', async () => {
      registerWorker();

      const promise = manager.runPersistent('test-worker', { config: {} });
      mockWorker.onmessage?.({ data: [1, 2, 3] });

      await expect(promise).resolves.toEqual([1, 2, 3]);
    });
  });

  describe('worker error events', () => {
    it('a worker that never replied is discarded and its calls reject', async () => {
      registerWorker();

      const promise = manager.runPersistent('test-worker', { config: {} });

      const errEvent = new ErrorEvent('error', {
        message: 'system crash',
        cancelable: true,
      });
      mockWorker.onerror?.(errEvent);

      await expect(promise).rejects.toThrow('system crash');
      expect(errEvent.defaultPrevented).toBe(true);
      expect(context.logger.error).toHaveBeenCalledWith(
        'Persistent worker test-worker encountered an error event',
        errEvent,
      );
      expect(context.terminateWorker).toHaveBeenCalledWith(mockWorker);
      expect(workerCount()).toBe(0);
    });

    it('a working worker that crashes rejects pending calls but is kept', async () => {
      registerWorker();

      const seed = manager.runPersistent('test-worker', {
        dataset: [1],
        config: {},
      });
      mockWorker.onmessage?.({
        data: { ok: true, data: 'seeded', id: requestId(mockWorker, 0) },
      });
      await seed;

      const a = manager.runPersistent('test-worker', { config: 'a' });
      const b = manager.runPersistent('test-worker', { config: 'b' });
      mockWorker.onerror?.(new ErrorEvent('error', { message: 'uncaught' }));

      await expect(a).rejects.toThrow('uncaught');
      await expect(b).rejects.toThrow('uncaught');
      expect(context.terminateWorker).not.toHaveBeenCalled();
      expect(workerCount()).toBe(1);
    });
  });

  it('releases a specific worker and rejects its pending calls', async () => {
    registerWorker();

    const pending = manager.runPersistent('test-worker', { config: {} });
    expect(workerCount()).toBe(1);

    manager.release('test-worker');

    await expect(pending).rejects.toThrow(
      'Persistent worker "test-worker" was released',
    );
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      __persistent__: 'release',
      type: 'release',
    });
    expect(context.terminateWorker).toHaveBeenCalledWith(mockWorker);
    expect(workerCount()).toBe(0);
  });

  it('terminates all workers and rejects their pending calls', async () => {
    registerWorker();

    const one = manager.runPersistent('worker1', { config: {} });
    const two = manager.runPersistent('worker2', { config: {} });
    expect(workerCount()).toBe(2);

    manager.terminateAll();

    await expect(one).rejects.toThrow('MainWorkerFactory has been terminated');
    await expect(two).rejects.toThrow('MainWorkerFactory has been terminated');
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      __persistent__: 'release',
      type: 'release',
    });
    expect(context.terminateWorker).toHaveBeenCalledTimes(2);
    expect(workerCount()).toBe(0);
  });

  it('rejects pending calls when the factory run is aborted', async () => {
    registerWorker();

    const pending = manager.runPersistent('test-worker', { config: {} });
    controller.abort();

    await expect(pending).rejects.toThrow(
      'MainWorkerFactory has been terminated',
    );
  });
});
