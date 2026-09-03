import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { executeWorker } from './run-worker';
import { RunWorkerContext } from './types';
import { WorkerResult } from '../main-worker-factory/types';
import { MemoryWorkerProxy } from '../memory-store/memory-worker-proxy';

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
      findWorkerByName: vi.fn().mockReturnValue({
        func: () => {},
      }),
      memoryWorkerProxy: {
        get: vi.fn().mockResolvedValue(['data1', 'data2']),
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

    it('resolves memory reference', async () => {
      await executeWorker(
        'testWorker' as never,
        { __memory_ref__: 'ref-123', deleteMemory: true },
        mockContext,
      );

      expect(mockContext.memoryWorkerProxy.get).toHaveBeenCalledWith('ref-123');
    });
  });
});
