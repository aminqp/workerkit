import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectWorkerResults } from './collect-results';
import { CollectResultsContext } from './types';
import {
  TypedSettledResults,
  WorkerResult,
} from '../main-worker-factory/types';

describe('collectWorkerResults', () => {
  let mockContext: CollectResultsContext;
  let mockLogger: { error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
    };

    mockContext = {
      isTerminated: vi.fn().mockReturnValue(false),
      logger: mockLogger as unknown as CollectResultsContext['logger'],
      trackWorker: vi.fn((w) => w),
      terminateWorker: vi.fn(),
      memoryWorkerProxy: {
        allocateWorkerPort: vi.fn().mockResolvedValue({} as MessagePort),
        get: vi.fn((ref: string) => {
          if (ref === 'ref-1') return [1];
          if (ref === 'ref-2') return [2];
          return [];
        }),
      } as unknown as CollectResultsContext['memoryWorkerProxy'],
      factoryToken: 'test-token',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if the context is terminated', async () => {
    vi.mocked(mockContext.isTerminated).mockReturnValue(true);

    const settled = new TypedSettledResults<unknown>([]);

    await expect(
      collectWorkerResults(settled, {}, mockContext),
    ).rejects.toThrow('MainWorkerFactory has been terminated');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Attempted to collect results after MainWorkerFactory was terminated',
    );
  });

  it('should merge results using default reducer when Worker is not available', async () => {
    const settled = new TypedSettledResults<number[]>([
      {
        status: 'fulfilled',
        value: { successResult: { data: [1, 2] } } as unknown as WorkerResult,
      },
      {
        status: 'fulfilled',
        value: { successResult: { data: [3, 4] } } as unknown as WorkerResult,
      },
    ]);

    const result = await collectWorkerResults(settled, {}, mockContext);

    expect(result).toEqual({
      data: [1, 2, 3, 4],
      succeeded: 2,
      failed: 0,
      errors: [],
    });
  });

  it('should handle errors in settled results', async () => {
    const settled = new TypedSettledResults<number[]>([
      {
        status: 'fulfilled',
        value: { successResult: { data: [1] } } as unknown as WorkerResult,
      },
      {
        status: 'rejected',
        reason: new Error('Worker failed'),
      },
    ]);

    const result = await collectWorkerResults(settled, {}, mockContext);

    expect(result.data).toEqual([1]);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toEqual(new Error('Worker failed'));
  });

  it('should merge results using a custom reducer', async () => {
    const settled = new TypedSettledResults<number>([
      {
        status: 'fulfilled',
        value: { successResult: { data: 10 } } as unknown as WorkerResult,
      },
      {
        status: 'fulfilled',
        value: { successResult: { data: 20 } } as unknown as WorkerResult,
      },
    ]);

    const options = {
      reducer: (shards: number[]) => shards.reduce((a, b) => a + b, 0),
    };

    const result = await collectWorkerResults(settled, options, mockContext);

    expect(result.data).toBe(30);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  // The memory_ref handling (memoryOnly, etc) was moved to executeWorker in run-worker.ts
  // collectWorkerResults now strictly fetches from MemoryWorkerProxy and merges data.

  describe('Worker offloading', () => {
    let originalWorker: typeof Worker;
    let originalURL: typeof URL;
    let originalBlob: typeof Blob;
    let originalMessageChannel: typeof MessageChannel;

    beforeEach(() => {
      originalWorker = globalThis.Worker;
      originalURL = globalThis.URL;
      originalBlob = globalThis.Blob;
      originalMessageChannel = globalThis.MessageChannel;

      // Mock Blob
      globalThis.Blob = class BlobMock {
        constructor(
          public content: BlobPart[],
          public options?: BlobPropertyBag,
        ) {}
      } as unknown as typeof Blob;

      // Mock URL.createObjectURL
      globalThis.URL = {
        ...originalURL,
        createObjectURL: vi.fn().mockReturnValue('blob:mock'),
      } as unknown as typeof URL;

      // Mock MessageChannel
      globalThis.MessageChannel = class {
        port1 = {} as MessagePort;
        port2 = {} as MessagePort;
      } as unknown as typeof MessageChannel;

      // Mock Worker
      globalThis.Worker = class WorkerMock {
        onmessage?: (ev: MessageEvent) => void;
        onerror?: (ev: ErrorEvent) => void;
        postMessage(_: unknown[]) {
          // Simulate worker message processing synchronously for test
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: { ok: true, data: [1, 2] },
              } as MessageEvent);
            }
          }, 0);
        }
      } as unknown as typeof Worker;
    });

    afterEach(() => {
      globalThis.Worker = originalWorker;
      globalThis.URL = originalURL;
      globalThis.Blob = originalBlob;
      globalThis.MessageChannel = originalMessageChannel;
    });

    it('should offload reducing to a Web Worker if available', async () => {
      const settled = new TypedSettledResults<number[]>([
        {
          status: 'fulfilled',
          value: {
            successResult: { data: { __memory_ref__: 'ref-1' } },
          } as unknown as WorkerResult,
        },
        {
          status: 'fulfilled',
          value: {
            successResult: { data: { __memory_ref__: 'ref-2' } },
          } as unknown as WorkerResult,
        },
      ]);

      const result = await collectWorkerResults(settled, {}, mockContext);

      expect(result.data).toEqual([1, 2]);
      expect(mockContext.trackWorker).toHaveBeenCalled();
      expect(mockContext.terminateWorker).toHaveBeenCalled();
    });

    it('should fallback if worker creation throws an error', async () => {
      globalThis.Worker = class WorkerThrows {
        constructor() {
          throw new Error('Worker creation failed');
        }
      } as unknown as typeof Worker;

      const settled = new TypedSettledResults<number[]>([
        {
          status: 'fulfilled',
          value: {
            successResult: { data: { __memory_ref__: 'ref-1' } },
          } as unknown as WorkerResult,
        },
        {
          status: 'fulfilled',
          value: {
            successResult: { data: { __memory_ref__: 'ref-2' } },
          } as unknown as WorkerResult,
        },
      ]);

      const result = await collectWorkerResults(settled, {}, mockContext);

      expect(result.data).toEqual([1, 2]);
      // trackWorker wouldn't be called successfully
    });

    it('should fallback to main thread if worker returns ok: false', async () => {
      globalThis.Worker = class WorkerMock {
        onmessage?: (ev: MessageEvent) => void;
        onerror?: (ev: ErrorEvent) => void;
        postMessage() {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: { ok: false, error: 'Reducer failed' },
              } as MessageEvent);
            }
          }, 0);
        }
      } as unknown as typeof Worker;

      const settled = new TypedSettledResults<number[]>([
        {
          status: 'fulfilled',
          value: {
            successResult: { data: { __memory_ref__: 'ref-1' } },
          } as unknown as WorkerResult,
        },
      ]);

      const result = await collectWorkerResults(settled, {}, mockContext);

      expect(result.data).toEqual([1]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Collect results reducer worker failed',
        'Reducer failed',
      );
    });

    it('should fallback to main thread if worker triggers onerror', async () => {
      const errorEvent = new Error('Network error');
      globalThis.Worker = class WorkerMock {
        onmessage?: (ev: MessageEvent) => void;
        onerror?: (ev: ErrorEvent) => void;
        postMessage() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror(errorEvent as unknown as ErrorEvent);
            }
          }, 0);
        }
      } as unknown as typeof Worker;

      const settled = new TypedSettledResults<number[]>([
        {
          status: 'fulfilled',
          value: {
            successResult: { data: { __memory_ref__: 'ref-1' } },
          } as unknown as WorkerResult,
        },
      ]);

      const result = await collectWorkerResults(settled, {}, mockContext);

      expect(result.data).toEqual([1]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Collect results reducer worker encountered an error event',
        errorEvent,
      );
    });
  });
});
