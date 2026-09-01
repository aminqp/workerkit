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

describe('PersistentWorkerManager', () => {
  let context: PersistentManagerContext;
  let manager: PersistentWorkerManager;
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: null | ((event: { data: unknown }) => void);
    onerror: null | ((event: ErrorEvent) => void);
  };

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

    context = {
      isTerminated: vi.fn().mockReturnValue(false),
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
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn(),
    });

    // Start one persistent worker
    manager.runPersistent('test-worker', {
      config: { query: 'test' },
      dataset: [1, 2],
    });

    expect(WorkerFactory).toHaveBeenCalledTimes(1);
    expect(context.trackWorker).toHaveBeenCalledWith(mockWorker);
    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      { type: 'run', config: { query: 'test' }, dataset: [1, 2] },
      [],
    );

    // Run again, proving it uses the cached worker instance
    manager.runPersistent('test-worker', { config: { query: 'test2' } });

    expect(WorkerFactory).toHaveBeenCalledTimes(1);
    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      { type: 'run', config: { query: 'test2' } },
      [],
    );
  });

  it('resolves with data when worker replies ok', async () => {
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn() as unknown as () => void,
      createWorker: undefined,
    });

    const promise = manager.runPersistent('test-worker', { config: {} });
    mockWorker.onmessage?.({ data: { ok: true, data: 'expected-result' } });

    const result = await promise;
    expect(result).toBe('expected-result');
  });

  it('rejects with error when worker replies ok: false', async () => {
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn() as unknown as () => void,
      createWorker: undefined,
    });

    const promise = manager.runPersistent('test-worker', { config: {} });
    mockWorker.onmessage?.({ data: { ok: false, error: 'worker crashed' } });

    await expect(promise).rejects.toThrow('worker crashed');
    expect(context.logger.error).toHaveBeenCalledWith(
      'Persistent worker test-worker failed',
      'worker crashed',
    );
  });

  it('rejects with error when worker emits an onerror event', async () => {
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn() as unknown as () => void,
      createWorker: undefined,
    });

    const promise = manager.runPersistent('test-worker', { config: {} });

    const errEvent = new ErrorEvent('error', { message: 'system crash' });
    mockWorker.onerror?.(errEvent);

    await expect(promise).rejects.toBe(errEvent);
    expect(context.logger.error).toHaveBeenCalledWith(
      'Persistent worker test-worker encountered an error event',
      errEvent,
    );
  });

  it('releases a specific worker', async () => {
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn() as unknown as () => void,
      createWorker: undefined,
    });

    manager.runPersistent('test-worker', { config: {} });

    expect(
      (manager as unknown as { _persistentWorkers: Map<string, Worker> })[
        '_persistentWorkers'
      ].size,
    ).toBe(1);

    manager.release('test-worker');

    expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'release' });
    expect(context.terminateWorker).toHaveBeenCalledWith(mockWorker);
    expect(
      (manager as unknown as { _persistentWorkers: Map<string, Worker> })[
        '_persistentWorkers'
      ].size,
    ).toBe(0);
  });

  it('terminates all workers', async () => {
    vi.mocked(context.findWorkerByName).mockReturnValue({
      name: 'test-worker',
      role: 'persistent',
      func: vi.fn() as unknown as () => void,
      createWorker: undefined,
    });

    // Note: mockWorker is shared in this test environment, but Map key is different
    manager.runPersistent('worker1', { config: {} });
    manager.runPersistent('worker2', { config: {} });

    expect(
      (manager as unknown as { _persistentWorkers: Map<string, Worker> })[
        '_persistentWorkers'
      ].size,
    ).toBe(2);

    manager.terminateAll();

    expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'release' });
    expect(context.terminateWorker).toHaveBeenCalledWith(mockWorker); // twice
    expect(
      (manager as unknown as { _persistentWorkers: Map<string, Worker> })[
        '_persistentWorkers'
      ].size,
    ).toBe(0);
  });
});
