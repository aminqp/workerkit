import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { executeWorker } from './run-worker';
import { RunWorkerContext } from './types';
import { WorkerResult } from '../main-worker-factory/types';
import { MemoryWorkerProxy } from '../memory-store/memory-worker-proxy';
import { MEMORY_INPUT } from '../memory-input';

vi.mock('../collect-results', () => ({
  collectWorkerResults: vi.fn().mockResolvedValue({
    data: ['test-result'],
    succeeded: 1,
    failed: 0,
    errors: [],
  }),
}));

describe('run-worker', () => {
  let mockContext: RunWorkerContext;
  let orchestratorCreateWorkerPromisesSpy: Mock;

  beforeEach(() => {
    orchestratorCreateWorkerPromisesSpy = vi.fn().mockReturnValue([
      Promise.resolve({
        status: 'fulfilled',
        value: { successResult: { data: 'test-result' } } as WorkerResult,
      }),
    ]);

    mockContext = {
      isTerminated: vi.fn().mockReturnValue(false),
      signal: new AbortController().signal,
      findWorkerByName: vi.fn().mockReturnValue({
        func: () => {},
      }),
      memoryWorkerProxy: {
        get: vi.fn().mockResolvedValue(['data1', 'data2']),
        set: vi.fn().mockResolvedValue('scratch-ref'),
        describe: vi
          .fn()
          .mockResolvedValue({ exists: true, isArray: true, length: 10 }),
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as MemoryWorkerProxy,
      threads: 4,
      orchestrator: {
        runWorkerWithRetry: vi.fn().mockResolvedValue({
          successResult: { data: 'test-result' },
        }),
        createWorkerPromises: orchestratorCreateWorkerPromisesSpy,
      } as unknown as RunWorkerContext['orchestrator'],
      logger: {
        error: vi.fn(),
        info: vi.fn(),
      } as unknown as RunWorkerContext['logger'],
      memoryStore: {
        has: vi.fn().mockReturnValue(true),
        register: vi.fn(),
        delete: vi.fn(),
      } as unknown as RunWorkerContext['memoryStore'],
      factoryToken: 'test-token',
    } as unknown as RunWorkerContext;
  });

  describe('executeWorker', () => {
    it('throws if context is terminated', async () => {
      (mockContext.isTerminated as Mock).mockReturnValue(true);
      await expect(
        executeWorker('testWorker' as never, {}, mockContext),
      ).rejects.toThrow('MainWorkerFactory has been terminated');
    });

    it('throws if worker is not found', async () => {
      (mockContext.findWorkerByName as Mock).mockReturnValue(undefined);
      await expect(
        executeWorker('unknownWorker' as never, {}, mockContext),
      ).rejects.toThrow('Worker "unknownWorker" not found');
    });

    it('executes a worker without partitioning', async () => {
      const result = await executeWorker(
        'testWorker' as never,
        { srcData: 'hello' },
        mockContext,
      );

      // Now it returns CollectedResult directly
      expect(result.data).toBeDefined();
    });

    /** The `data` and thread count passed on to the workers. */
    const dispatched = () => {
      const [, , input, threads, partitioned] =
        orchestratorCreateWorkerPromisesSpy.mock.calls[0];
      return { data: input.data, threads, partitioned };
    };

    it('starts from a memory ref without fetching it: workers read it themselves', async () => {
      await executeWorker(
        'testWorker' as never,
        { __memory_ref__: 'ref-123', deleteMemory: true },
        mockContext,
      );

      expect(mockContext.memoryWorkerProxy.get).not.toHaveBeenCalled();
      expect(dispatched()).toEqual({
        data: { [MEMORY_INPUT]: { ref: 'ref-123' } },
        threads: 4,
        partitioned: false,
      });
      // freed once every worker has read it
      expect(mockContext.memoryWorkerProxy.delete).toHaveBeenCalledWith(
        'ref-123',
      );
    });

    it('a partitioned run from a ref gives each worker its part, planned from the stored length', async () => {
      (mockContext.findWorkerByName as Mock).mockReturnValue({
        func: () => {},
        partition: true,
      });
      await executeWorker(
        'testWorker' as never,
        { __memory_ref__: 'ref-123' },
        mockContext,
      );

      expect(mockContext.memoryWorkerProxy.describe).toHaveBeenCalledWith(
        'ref-123',
      );
      expect(dispatched()).toEqual({
        data: [0, 1, 2, 3].map((index) => ({
          [MEMORY_INPUT]: { ref: 'ref-123', part: { index, count: 4 } },
        })),
        threads: 4,
        partitioned: true,
      });
    });

    it('a hand-written bundled worker is sent the data itself', async () => {
      (mockContext.findWorkerByName as Mock).mockReturnValue({
        createWorker: () => ({}) as Worker,
      });
      await executeWorker(
        'testWorker' as never,
        { __memory_ref__: 'ref-123' },
        mockContext,
      );

      expect(mockContext.memoryWorkerProxy.get).toHaveBeenCalledWith('ref-123');
      expect(dispatched().data).toEqual(['data1', 'data2']);
    });

    it('the same srcData for several threads is stored once and read by each', async () => {
      await executeWorker(
        'testWorker' as never,
        { srcData: { big: true } },
        mockContext,
      );

      expect(mockContext.memoryWorkerProxy.set).toHaveBeenCalledTimes(1);
      expect(mockContext.memoryWorkerProxy.set).toHaveBeenCalledWith(
        { big: true },
        undefined,
        [],
      );
      expect(dispatched()).toEqual({
        data: { [MEMORY_INPUT]: { ref: 'scratch-ref' } },
        threads: 4,
        partitioned: false,
      });
      expect(mockContext.memoryWorkerProxy.delete).toHaveBeenCalledWith(
        'scratch-ref',
      );
    });

    it('srcData that cannot be stored is posted to each thread as before', async () => {
      (mockContext.memoryWorkerProxy.set as Mock).mockRejectedValue(
        new Error('DataCloneError'),
      );
      await executeWorker(
        'testWorker' as never,
        { srcData: { big: true } },
        mockContext,
      );

      expect(dispatched().data).toEqual({ big: true });
    });

    it('a single thread, or partitioned srcData, is posted directly', async () => {
      (mockContext.findWorkerByName as Mock).mockReturnValue({
        func: () => {},
        partition: true,
      });
      await executeWorker(
        'testWorker' as never,
        { srcData: [1, 2, 3, 4] },
        mockContext,
      );

      expect(mockContext.memoryWorkerProxy.set).not.toHaveBeenCalled();
      expect(dispatched().data).toEqual([[1], [2], [3], [4]]);
    });
  });
});
