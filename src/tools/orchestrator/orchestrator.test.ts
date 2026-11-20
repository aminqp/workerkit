import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerOrchestrator } from './orchestrator';
import { OrchestratorContext } from './types';
import { WorkerFactory } from '../worker-factory';

vi.mock('../worker-factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../worker-factory')>();
  return {
    ...actual,
    WorkerFactory: vi.fn(),
  };
});

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('WorkerOrchestrator', () => {
  let context: OrchestratorContext;
  let orchestrator: WorkerOrchestrator;
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: null | ((event: { data: unknown }) => void);
    onerror: null | ((event: Error) => void);
    terminate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    };

    vi.mocked(WorkerFactory).mockImplementation(() => {
      return {
        getWorker: mockWorker,
      } as unknown as WorkerFactory;
    });

    context = {
      isTerminated: vi.fn().mockReturnValue(false),
      signal: new AbortController().signal,
      trackWorker: vi.fn((worker) => worker),
      terminateWorker: vi.fn(),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        verbose: vi.fn(),
      } as unknown as OrchestratorContext['logger'],
      memoryWorkerProxy: {
        allocateWorkerPort: vi.fn().mockResolvedValue({} as MessagePort),
      } as unknown as OrchestratorContext['memoryWorkerProxy'],
      factoryToken: 'test-token',
    };

    orchestrator = new WorkerOrchestrator(context);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createWorkerPromises splits data when isPartitioned is true', () => {
    const runSpy = vi
      .spyOn(orchestrator, 'runWorkerWithRetry')
      .mockReturnValue(
        Promise.resolve(
          {} as unknown as import('../main-worker-factory/types').WorkerResult,
        ),
      );

    const config = {
      func: vi.fn(),
      retries: 0,
    } as unknown as import('../main-worker-factory/types').WorkerConfig;
    orchestrator.createWorkerPromises(
      config,
      'test-worker',
      { data: ['chunk1', 'chunk2'], otherProp: 'test' },
      2,
      true,
    );

    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(runSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { data: 'chunk1', otherProp: 'test' },
        index: 0,
      }),
      0,
      context.signal,
    );
    expect(runSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { data: 'chunk2', otherProp: 'test' },
        index: 1,
      }),
      0,
      context.signal,
    );
  });

  it('createWorkerPromises broadcasts data when isPartitioned is false', () => {
    const runSpy = vi
      .spyOn(orchestrator, 'runWorkerWithRetry')
      .mockReturnValue(
        Promise.resolve(
          {} as unknown as import('../main-worker-factory/types').WorkerResult,
        ),
      );

    const config = {
      func: vi.fn(),
      retries: 0,
    } as unknown as import('../main-worker-factory/types').WorkerConfig;
    orchestrator.createWorkerPromises(
      config,
      'test-worker',
      { data: ['chunk1', 'chunk2'] },
      2,
      false,
    );

    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(runSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { data: ['chunk1', 'chunk2'] },
        index: 0,
      }),
      0,
      context.signal,
    );
    expect(runSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { data: ['chunk1', 'chunk2'] },
        index: 1,
      }),
      0,
      context.signal,
    );
  });

  it('resolves successfully on first try', async () => {
    const promise = orchestrator.runWorkerWithRetry(
      {
        workerFunc: vi.fn() as unknown as () => void,
        workerName: 'test',
        index: 0,
        data: { data: 'payload' },
      },
      0,
    );

    await flushPromises();
    mockWorker.onmessage!({ data: { ok: true, data: 'success-result' } });

    const result = await promise;
    expect(result.index).toBe(0);
    expect(result.successResult?.data).toBe('success-result');
    expect(context.trackWorker).toHaveBeenCalledWith(mockWorker);
    expect(context.terminateWorker).toHaveBeenCalledWith(mockWorker);
  });

  it('retries when worker throws an error via onerror', async () => {
    const promise = orchestrator.runWorkerWithRetry(
      {
        workerFunc: vi.fn() as unknown as () => void,
        workerName: 'test',
        index: 0,
        data: { data: 'payload' },
      },
      1,
    );

    await flushPromises();
    mockWorker.onerror!(new Error('crash'));

    await flushPromises();
    mockWorker.onmessage!({ data: { ok: true, data: 'retry-success' } });

    const result = await promise;
    expect(result.index).toBe(0);
    expect(result.successResult?.data).toBe('retry-success');
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('retrying (1 left)'),
      expect.anything(),
    );
  });

  it('fails after all retries are exhausted', async () => {
    const promise = orchestrator.runWorkerWithRetry(
      {
        workerFunc: vi.fn() as unknown as () => void,
        workerName: 'test',
        index: 0,
        data: { data: 'payload' },
      },
      1,
    );

    await flushPromises();
    mockWorker.onmessage!({ data: { ok: false, error: 'first fail' } });

    await flushPromises();
    mockWorker.onerror!(new Error('second fail'));

    await expect(promise).rejects.toMatchObject({
      index: 0,
      failedResult: expect.any(Error),
    });
    expect(context.logger.error).toHaveBeenCalledWith(
      'Worker failed after all retries:',
      expect.anything(),
    );
  });

  it('rejects early if context is terminated', async () => {
    vi.mocked(context.isTerminated).mockReturnValue(true);

    await expect(
      orchestrator.runWorkerWithRetry(
        {
          workerFunc: vi.fn() as unknown as () => void,
          workerName: 'test',
          index: 0,
          data: { data: 'payload' },
        },
        0,
      ),
    ).rejects.toThrow('MainWorkerFactory has been terminated');

    expect(WorkerFactory).not.toHaveBeenCalled();
  });

  describe('cancellation (factory terminated mid-call)', () => {
    const instance = {
      workerFunc: vi.fn() as unknown as () => void,
      workerName: 'test',
      index: 0,
      data: { data: 'payload' },
    };

    it('rejects and stops the worker when the signal aborts', async () => {
      const controller = new AbortController();
      const promise = orchestrator.runWorkerWithRetry(
        instance,
        0,
        controller.signal,
      );
      await flushPromises();

      controller.abort();

      await expect(promise).rejects.toThrow(
        'MainWorkerFactory has been terminated',
      );
      expect(context.terminateWorker).toHaveBeenCalledWith(mockWorker);
    });

    it('never retries a cancelled call', async () => {
      const controller = new AbortController();
      const promise = orchestrator.runWorkerWithRetry(
        instance,
        5,
        controller.signal,
      );
      await flushPromises();
      controller.abort();
      await expect(promise).rejects.toThrow('terminated');
      await flushPromises();

      expect(WorkerFactory).toHaveBeenCalledTimes(1);
      expect(context.logger.info).not.toHaveBeenCalled();
    });

    it('does not start a worker for an already-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        orchestrator.runWorkerWithRetry(instance, 2, controller.signal),
      ).rejects.toThrow('terminated');
      expect(WorkerFactory).not.toHaveBeenCalled();
    });
  });

  it('marks worker error events as handled', async () => {
    const promise = orchestrator.runWorkerWithRetry(
      {
        workerFunc: vi.fn() as unknown as () => void,
        workerName: 'test',
        index: 0,
        data: { data: 'payload' },
      },
      0,
    );
    await flushPromises();

    const event = new ErrorEvent('error', {
      message: 'boom',
      cancelable: true,
    });
    mockWorker.onerror!(event as unknown as Error);

    await expect(promise).rejects.toMatchObject({ index: 0 });
    expect(event.defaultPrevented).toBe(true);
  });
});
