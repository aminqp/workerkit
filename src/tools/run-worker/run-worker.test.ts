import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { executeWorker, storeWorkerMemoryResult } from './run-worker';
import { RunWorkerContext } from './types';
import { WorkerResult } from '../main-worker-factory/types';

describe('run-worker', () => {
  let mockContext: RunWorkerContext;
  let orchestratorCreateWorkerPromisesSpy: Mock;

  beforeEach(() => {
    orchestratorCreateWorkerPromisesSpy = vi.fn().mockReturnValue([
      Promise.resolve({
        successResult: new MessageEvent('message', {
          data: { data: 'test-result' },
        }),
      }),
    ]);

    mockContext = {
      isTerminated: vi.fn().mockReturnValue(false),
      findWorkerByName: vi.fn().mockReturnValue({
        func: () => {},
      }),
      memoryStore: {
        has: vi.fn().mockReturnValue(true),
        get: vi.fn().mockReturnValue(['data1', 'data2']),
        set: vi.fn().mockReturnValue('ref-123'),
        delete: vi.fn(),
      } as unknown as RunWorkerContext['memoryStore'],
      threads: 4,
      orchestrator: {
        createWorkerPromises: orchestratorCreateWorkerPromisesSpy,
      } as unknown as RunWorkerContext['orchestrator'],
      logger: {
        error: vi.fn(),
      } as unknown as RunWorkerContext['logger'],
    };
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

      expect(orchestratorCreateWorkerPromisesSpy).toHaveBeenCalledWith(
        expect.any(Object),
        'testWorker',
        { data: 'hello' },
        4, // default threads
        false, // shouldPartition
      );

      expect(result.results.length).toBe(1);
    });

    it('resolves memory reference and deletes it if requested', async () => {
      await executeWorker(
        'testWorker' as never,
        { __memory_ref__: 'ref-123', deleteMemory: true },
        mockContext,
      );

      expect(mockContext.memoryStore.get).toHaveBeenCalledWith('ref-123');
      expect(mockContext.memoryStore.delete).toHaveBeenCalledWith('ref-123');

      expect(orchestratorCreateWorkerPromisesSpy).toHaveBeenCalledWith(
        expect.any(Object),
        'testWorker',
        { data: ['data1', 'data2'] },
        4,
        false,
      );
    });

    it('partitions data if worker config has partition: true and data is array', async () => {
      (mockContext.findWorkerByName as Mock).mockReturnValue({
        func: () => {},
        partition: true,
      });

      await executeWorker(
        'testWorker' as never,
        { srcData: [1, 2, 3, 4, 5] },
        mockContext,
      );

      expect(orchestratorCreateWorkerPromisesSpy).toHaveBeenCalledWith(
        expect.any(Object),
        'testWorker',
        { data: expect.any(Array) },
        4, // max concurrency limits partitions
        true,
      );
    });
  });

  describe('storeWorkerMemoryResult', () => {
    it('stores results in memory and modifies the PromiseSettledResult', () => {
      const settled: PromiseSettledResult<WorkerResult>[] = [
        {
          status: 'fulfilled',
          value: { successResult: { data: 'res1' } } as unknown as WorkerResult,
        },
        {
          status: 'fulfilled',
          value: { successResult: { data: 'res2' } } as unknown as WorkerResult,
        },
        { status: 'rejected', reason: new Error() },
      ];

      storeWorkerMemoryResult(
        settled,
        { memoryOnly: false, shouldPartition: true },
        mockContext,
      );

      expect(mockContext.memoryStore.set).toHaveBeenCalledWith([
        'res1',
        'res2',
      ]);

      // Should have mutated successResult to include __memory_ref__
      expect(
        (settled[0] as PromiseFulfilledResult<WorkerResult>).value.successResult
          ?.data,
      ).toEqual({
        data: 'res1',
        __memory_ref__: 'ref-123',
      });
    });
  });
});
