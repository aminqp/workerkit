import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerOrchestrator } from './orchestrator';
import { OrchestratorContext } from './types';
import { WorkerFactory } from '../worker-factory';

vi.mock('../worker-factory', () => {
  return {
    WorkerFactory: vi.fn(),
  };
});

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
      trackWorker: vi.fn((worker) => worker),
      terminateWorker: vi.fn(),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        verbose: vi.fn(),
      } as unknown as OrchestratorContext['logger'],
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
    );
    expect(runSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { data: 'chunk2', otherProp: 'test' },
        index: 1,
      }),
      0,
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
    );
    expect(runSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { data: ['chunk1', 'chunk2'] },
        index: 1,
      }),
      0,
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

    mockWorker.onerror!(new Error('crash'));

    setTimeout(() => {
      mockWorker.onmessage!({ data: { ok: true, data: 'retry-success' } });
    }, 10);

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

    mockWorker.onmessage!({ data: { ok: false, error: 'first fail' } });

    setTimeout(() => {
      mockWorker.onerror!(new Error('second fail'));
    }, 10);

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
});
