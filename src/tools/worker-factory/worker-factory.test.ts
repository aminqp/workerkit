import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkerFunction } from '../main-worker-factory/types';

// ---------------------------------------------------------------------------
// Mock Worker + URL.createObjectURL before importing WorkerFactory
// ---------------------------------------------------------------------------

type WorkerMock = {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

const workerInstances: WorkerMock[] = [];

const MockWorker = vi.fn(function (this: WorkerMock) {
  this.postMessage = vi.fn();
  this.terminate = vi.fn();
  this.onmessage = null;
  this.onerror = null;
  workerInstances.push(this);
});

vi.stubGlobal('Worker', MockWorker);
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

// Capture the real Blob before we spy, so the spy doesn't recurse into itself
const RealBlob = globalThis.Blob;
const blobParts: BlobPart[][] = [];
const BlobSpy = vi.fn(function (parts: BlobPart[], options?: BlobPropertyBag) {
  blobParts.push(parts);
  return new RealBlob(parts, options);
});
vi.stubGlobal('Blob', BlobSpy);

import WorkerFactory from './worker-factory';

// ---------------------------------------------------------------------------

beforeEach(() => {
  workerInstances.length = 0;
  blobParts.length = 0;
  MockWorker.mockClear();
  BlobSpy.mockClear();
  (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();
});

// ── positive tests ──────────────────────────────────────────────────────────

describe('WorkerFactory – positive', () => {
  it('creates a Worker on construction', () => {
    new WorkerFactory(() => {});
    expect(MockWorker).toHaveBeenCalledTimes(1);
  });

  it('getWorker returns the underlying Worker instance', () => {
    const factory = new WorkerFactory(() => {});
    expect(factory.getWorker).toBe(workerInstances[0]);
  });

  it('calls URL.createObjectURL once', () => {
    new WorkerFactory(() => {});
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('creates the Blob with type application/javascript', () => {
    new WorkerFactory(() => {});
    expect(BlobSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ type: 'application/javascript' }),
    );
  });

  it('embeds the function body in the worker code', () => {
    const fn = function double(x: number) {
      return x * 2;
    };
    new WorkerFactory(fn as WorkerFunction);
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain(fn.toString());
  });

  it('wraps the function in a message event listener', () => {
    new WorkerFactory(() => {});
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain("self.addEventListener('message'");
  });

  it('calls self.postMessage in the generated template', () => {
    new WorkerFactory(() => {});
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain(
      'self.postMessage({ ok: true, data: output }, extractTransferables(output))',
    );
  });

  it('each WorkerFactory instance creates an independent Worker', () => {
    new WorkerFactory(() => {});
    new WorkerFactory(() => {});
    expect(MockWorker).toHaveBeenCalledTimes(2);
    expect(workerInstances[0]).not.toBe(workerInstances[1]);
  });
});

// ── native behaviour tests ──────────────────────────────────────────────────

describe('WorkerFactory – native behaviour', () => {
  it('passes the blob URL to the Worker constructor', () => {
    new WorkerFactory(() => {});
    expect(MockWorker).toHaveBeenCalledWith('blob:mock-url');
  });

  it('generated code calls the function with event.data', () => {
    new WorkerFactory(() => {});
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain('event.data');
  });

  it('generated code posts error on failure', () => {
    new WorkerFactory(() => {});
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain('ok: false');
  });

  it('_worker property is the same object as getWorker', () => {
    const factory = new WorkerFactory(() => {});
    expect(factory._worker).toBe(factory.getWorker);
  });
});

// ── edge cases ──────────────────────────────────────────────────────────────

describe('WorkerFactory – edge cases', () => {
  it('works with an arrow function', () => {
    const fn = (x: number) => x + 1;
    expect(() => new WorkerFactory(fn as WorkerFunction)).not.toThrow();
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain(fn.toString());
  });

  it('works with a named function', () => {
    function compute(n: number) {
      return n * n;
    }
    expect(() => new WorkerFactory(compute as WorkerFunction)).not.toThrow();
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain('compute');
  });

  it('works with a no-op function', () => {
    expect(() => new WorkerFactory(() => {})).not.toThrow();
  });

  it('works with a multi-param function', () => {
    const fn = (a: number, b: number) => a + b;
    expect(() => new WorkerFactory(fn as WorkerFunction)).not.toThrow();
    const blobContent = blobParts[0][0] as string;
    expect(blobContent).toContain(fn.toString());
  });

  it('_worker is readonly at the TypeScript level', () => {
    // readonly is a compile-time constraint; at runtime the property exists and holds the Worker
    const factory = new WorkerFactory(() => {});
    expect(factory._worker).toBeDefined();
    expect(factory._worker).toBe(workerInstances[0]);
  });
});
