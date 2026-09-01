import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { executePipeline } from './pipeline';
import { PipelineContext } from './types';

// Mock WorkerFactory
vi.mock('../worker-factory', () => {
  return {
    WorkerFactory: vi.fn().mockImplementation(() => {
      const mockWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        onmessage: null as ((ev: unknown) => void) | null,
        onerror: null as ((ev: unknown) => void) | null,
      };
      return {
        getWorker: mockWorker,
      };
    }),
  };
});

import { WorkerFactory } from '../worker-factory';

describe('executePipeline', () => {
  let mockContext: PipelineContext;
  let terminateWorkerSpy: Mock;
  let trackWorkerSpy: Mock;

  beforeEach(() => {
    terminateWorkerSpy = vi.fn();
    trackWorkerSpy = vi.fn((w) => w);

    mockContext = {
      memoryStore: {
        has: vi.fn().mockReturnValue(true),
        get: vi.fn().mockReturnValue({ previous: 'data' }),
        set: vi.fn().mockReturnValue('ref-123'),
        delete: vi.fn(),
      } as unknown as PipelineContext['memoryStore'],
      isTerminated: vi.fn().mockReturnValue(false),
      findWorkerByName: vi.fn().mockReturnValue({
        func: () => {},
        createWorker: undefined,
      }),
      trackWorker: trackWorkerSpy,
      terminateWorker: terminateWorkerSpy,
      logger: {
        verbose: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      } as unknown as PipelineContext['logger'],
    };

    vi.clearAllMocks();
  });

  it('throws if context is terminated', async () => {
    (mockContext.isTerminated as Mock).mockReturnValue(true);
    await expect(
      executePipeline([{ worker: 'step1' }], mockContext),
    ).rejects.toThrow('MainWorkerFactory has been terminated');
  });

  it('throws if pipeline is empty', async () => {
    await expect(executePipeline([], mockContext)).rejects.toThrow(
      'Pipeline requires at least one step',
    );
  });

  it('throws if worker is not found', async () => {
    (mockContext.findWorkerByName as Mock).mockReturnValue(undefined);
    await expect(
      executePipeline([{ worker: 'unknown' }], mockContext),
    ).rejects.toThrow('Worker "unknown" not found');
  });

  it('executes a single-step pipeline', async () => {
    const promise = executePipeline(
      [{ worker: 'step1', srcData: { hello: 'world' } }],
      mockContext,
    );

    // Get the mocked worker instance
    const workerInstance = (WorkerFactory as Mock).mock.results[0].value
      .getWorker;
    expect(workerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hello: 'world' }, index: 0 }),
      expect.any(Array),
    );

    // Simulate success
    workerInstance.onmessage!({ data: { ok: true, data: 'result' } });

    const result = await promise;
    expect(result).toBe('result');
    expect(terminateWorkerSpy).toHaveBeenCalledWith(workerInstance);
  });

  it('executes a multi-step pipeline', async () => {
    const promise = executePipeline(
      [{ worker: 'step1', srcData: { init: true } }, { worker: 'step2' }],
      mockContext,
    );

    expect(WorkerFactory).toHaveBeenCalledTimes(2);

    const worker1 = (WorkerFactory as Mock).mock.results[0].value.getWorker;
    const worker2 = (WorkerFactory as Mock).mock.results[1].value.getWorker;

    // Both workers should get a config payload containing __pipeline_ports__
    expect(worker1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ __pipeline_ports__: true }),
      expect.any(Array),
    );

    expect(worker2.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ __pipeline_ports__: true }),
      expect.any(Array),
    );

    // First worker should get the initial data
    expect(worker1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { init: true }, index: 0 }),
      expect.any(Array),
    );

    // Simulate success of second worker
    worker2.onmessage!({ data: { ok: true, data: 'final-result' } });

    const result = await promise;
    expect(result).toBe('final-result');
    expect(terminateWorkerSpy).toHaveBeenCalledWith(worker1);
    expect(terminateWorkerSpy).toHaveBeenCalledWith(worker2);
  });
});
