import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryWorkerProxy } from './memory-worker-proxy';
import { forgetScriptUrls } from '../worker-factory/script-url';

/** A fake MemoryWorker that only answers when told to. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: Array<{ message: Record<string, unknown>; transfer?: unknown[] }> =
    [];
  terminate = vi.fn();
  constructor(public url: string) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: Record<string, unknown>, transfer?: unknown[]) {
    this.posted.push({ message, transfer });
  }
  /** Replies to the most recent request with `action`. */
  reply(action: string, extra: Record<string, unknown> = {}) {
    const request = [...this.posted]
      .reverse()
      .find((p) => p.message.action === action);
    this.onmessage?.({ data: { ok: true, id: request!.message.id, ...extra } });
  }
}

describe('MemoryWorkerProxy', () => {
  let proxy: MemoryWorkerProxy;
  let createObjectURL: ReturnType<typeof vi.fn<[], string>>;
  /** The MemoryWorker — only exists once the proxy has started it. */
  const worker = () => FakeWorker.instances[0];

  beforeEach(() => {
    FakeWorker.instances = [];
    createObjectURL = vi.fn(() => 'blob:memory-worker');
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    forgetScriptUrls();
    proxy = new MemoryWorkerProxy('token');
  });

  afterEach(() => {
    forgetScriptUrls();
    vi.unstubAllGlobals();
  });

  describe('lazy start', () => {
    it('starts no thread when created', () => {
      expect(FakeWorker.instances).toHaveLength(0);
      expect(proxy.isStarted).toBe(false);
    });

    it('answers read-only requests without starting a thread', async () => {
      await expect(proxy.stats()).resolves.toEqual({ count: 0, refs: [] });
      await expect(proxy.get('ref')).resolves.toBeUndefined();
      await expect(proxy.has('ref')).resolves.toBe(false);
      await expect(proxy.delete('ref')).resolves.toBe(false);
      await expect(proxy.clear()).resolves.toBeUndefined();
      await expect(proxy.describe('ref')).resolves.toEqual({
        exists: false,
        isArray: false,
      });
      expect(FakeWorker.instances).toHaveLength(0);
    });

    it('starts the thread on the first request that needs it, with the token handshake first', async () => {
      void proxy.set('data');
      expect(FakeWorker.instances).toHaveLength(1);
      expect(proxy.isStarted).toBe(true);
      expect(worker().posted[0].message).toEqual({
        action: 'INIT_TOKEN',
        expectedToken: 'token',
      });
      expect(worker().posted[1].message).toMatchObject({ action: 'SET' });

      void proxy.set('more');
      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('all MemoryWorkers share one blob URL', () => {
      void proxy.set('data');
      void new MemoryWorkerProxy('other-token').set('data');
      expect(FakeWorker.instances).toHaveLength(2);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(FakeWorker.instances[1].url).toBe(FakeWorker.instances[0].url);
    });

    it('terminate() before first use starts nothing and rejects later calls', async () => {
      proxy.terminate();
      await expect(proxy.stats()).rejects.toThrow('terminated');
      await expect(proxy.set('data')).rejects.toThrow('terminated');
      expect(FakeWorker.instances).toHaveLength(0);
    });
  });

  it('resolves requests with the matching reply', async () => {
    void proxy.set('data');
    const stats = proxy.stats();
    worker().reply('STATS', { stats: { count: 2, refs: ['a', 'b'] } });
    await expect(stats).resolves.toEqual({ count: 2, refs: ['a', 'b'] });
  });

  it('allocateWorkerPort transfers one port and resolves after the ACK', async () => {
    let resolved = false;
    const port = proxy.allocateWorkerPort().then((p) => {
      resolved = true;
      return p;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    const request = worker().posted.find(
      (p) => p.message.action === 'REGISTER_PORT',
    )!;
    expect(request.transfer).toHaveLength(1);

    worker().reply('REGISTER_PORT', { action: 'PORT_REGISTERED' });
    await expect(port).resolves.toBeInstanceOf(MessagePort);
  });

  it('terminate() rejects requests that are still waiting', async () => {
    const pending = [
      proxy.allocateWorkerPort(),
      proxy.get('ref'),
      proxy.stats(),
      proxy.set('data'),
    ];
    proxy.terminate();

    for (const request of pending) {
      await expect(request).rejects.toThrow(
        'MainWorkerFactory has been terminated',
      );
    }
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects every call after terminate() without posting to the dead worker', async () => {
    void proxy.set('data').catch(() => {});
    proxy.terminate();
    const postedBefore = worker().posted.length;

    await expect(proxy.set('data')).rejects.toThrow('terminated');
    await expect(proxy.clear()).rejects.toThrow('terminated');
    await expect(proxy.allocateWorkerPort()).rejects.toThrow('terminated');
    expect(worker().posted.length).toBe(postedBefore);
    expect(proxy.isTerminated).toBe(true);
  });

  it('terminate() is idempotent', () => {
    void proxy.set('data').catch(() => {});
    proxy.terminate();
    proxy.terminate();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });
});
