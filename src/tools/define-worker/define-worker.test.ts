import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineWorker } from './define-worker';

describe('defineWorker helper', () => {
  let origSelf: typeof globalThis.self | undefined;
  let listeners: Record<string, (e: MessageEvent) => void>;
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    origSelf = globalThis.self;
    listeners = {};
    postMessageSpy = vi.fn();

    // Mock global self
    (globalThis as unknown as Record<string, unknown>).self = {
      addEventListener: (type: string, cb: (e: MessageEvent) => void) => {
        listeners[type] = cb;
      },
      postMessage: postMessageSpy,
    };
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).self = origSelf;
    vi.restoreAllMocks();
  });

  it('exits early if self is undefined', () => {
    (globalThis as unknown as Record<string, unknown>).self = undefined;
    const fn = vi.fn();
    expect(() => defineWorker(fn)).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('handles standard worker message execution', async () => {
    const fn = vi.fn(({ data }: { data: number }) => data * 2);
    defineWorker(fn);

    listeners['message']({ data: { data: 5 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith({ data: 5 });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: true, data: 10 },
      expect.anything(),
    );
  });

  it('handles standard worker execution with primitive data', async () => {
    const fn = vi.fn(
      ({ data, index }: { data: number; index: number }) => data * 2 + index,
    );
    defineWorker(fn);

    listeners['message']({ data: 5 } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith({ data: 5, index: 0 });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: true, data: 10 },
      expect.anything(),
    );
  });

  it('handles standard worker execution with async workerFn', async () => {
    const fn = vi.fn(async ({ data }: { data: number }) => {
      return data * 3;
    });
    defineWorker(fn);

    listeners['message']({ data: { data: 10 } } as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));

    expect(fn).toHaveBeenCalledWith({ data: 10 });
    expect(postMessageSpy).toHaveBeenCalledWith({ ok: true, data: 30 }, []);
  });

  it('handles synchronous errors in workerFn', async () => {
    const fn = vi.fn(() => {
      throw new Error('Sync error');
    });
    defineWorker(fn);

    listeners['message']({ data: { data: 10 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: false, error: 'Sync error' },
      undefined,
    );
  });

  it('handles asynchronous errors in workerFn', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Async error');
    });
    defineWorker(fn);

    listeners['message']({ data: { data: 10 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: false, error: 'Async error' },
      undefined,
    );
  });

  it('handles non-Error objects thrown in workerFn', async () => {
    const fn = vi.fn(() => {
      throw 'String error';
    });
    defineWorker(fn);

    listeners['message']({ data: { data: 10 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: false, error: 'String error' },
      undefined,
    );
  });

  it('merges stepParams with data object', async () => {
    const fn = vi.fn(
      ({ data, myParam }: { data: number; myParam?: number }) =>
        data + (myParam ?? 0),
    );
    defineWorker(fn);

    listeners['message']({
      data: { __pipeline_ports__: true, stepParams: { myParam: 42 } },
    } as MessageEvent);

    listeners['message']({ data: { data: 5 } } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith({ data: 5, myParam: 42 });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: true, data: 47 },
      expect.anything(),
    );
  });

  it('receives stepParams (configs and options) in pipeline mode', async () => {
    const fn = vi.fn(
      ({
        data,
        configs,
        options,
      }: {
        data: number[];
        configs?: { multiplier: number };
        options?: { prefix: string };
      }) => {
        return data.map(
          (x: number) =>
            (options?.prefix ?? '') + (configs?.multiplier ?? 1) * x,
        );
      },
    );
    defineWorker(fn);

    const inputPortListeners: Record<string, (e: MessageEvent) => void> = {};
    const inputPort = {
      set onmessage(cb: (e: MessageEvent) => void) {
        inputPortListeners['message'] = cb;
      },
    };
    const outputPort = {
      postMessage: vi.fn(),
    };

    listeners['message']({
      data: {
        __pipeline_ports__: true,
        stepParams: { configs: { multiplier: 3 }, options: { prefix: 'test' } },
        inputPort,
        outputPort,
      },
    } as MessageEvent);

    inputPortListeners['message']({
      data: { ok: true, data: [10, 20] },
    } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith({
      data: [10, 20],
      configs: { multiplier: 3 },
      options: { prefix: 'test' },
      index: 0,
    });

    expect(outputPort.postMessage).toHaveBeenCalledWith(
      { ok: true, data: ['test30', 'test60'] },
      expect.anything(),
    );
  });

  it('stores message as pendingData if inputPort is already configured, and processes it on next __pipeline_ports__', async () => {
    const fn = vi.fn(({ data }: { data: number }) => data * 2);
    defineWorker(fn);

    // 1. Configure inputPort
    listeners['message']({
      data: {
        __pipeline_ports__: true,
        inputPort: {
          set onmessage(_cb: (e: MessageEvent) => void) {},
        },
      },
    } as MessageEvent);

    // 2. Send regular message, should be stored in pendingData
    listeners['message']({ data: { data: 5 } } as MessageEvent);
    expect(fn).not.toHaveBeenCalled();

    // 3. Send another __pipeline_ports__ message, should process pendingData
    listeners['message']({
      data: {
        __pipeline_ports__: true,
      },
    } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith({ data: 5 });
  });

  it('forwards error from inputPort to outputPort if configured', async () => {
    const fn = vi.fn();
    defineWorker(fn);

    const inputPortListeners: Record<string, (e: MessageEvent) => void> = {};
    const inputPort = {
      set onmessage(cb: (e: MessageEvent) => void) {
        inputPortListeners['message'] = cb;
      },
    };
    const outputPort = { postMessage: vi.fn() };

    listeners['message']({
      data: { __pipeline_ports__: true, inputPort, outputPort },
    } as MessageEvent);

    // Simulate error from inputPort
    inputPortListeners['message']({
      data: { ok: false, error: 'Previous worker failed' },
    } as MessageEvent);

    expect(outputPort.postMessage).toHaveBeenCalledWith({
      ok: false,
      error: 'Previous worker failed',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('forwards error from inputPort to postMessage if outputPort not configured', async () => {
    const fn = vi.fn();
    defineWorker(fn);

    const inputPortListeners: Record<string, (e: MessageEvent) => void> = {};
    const inputPort = {
      set onmessage(cb: (e: MessageEvent) => void) {
        inputPortListeners['message'] = cb;
      },
    };

    listeners['message']({
      data: { __pipeline_ports__: true, inputPort },
    } as MessageEvent);

    // Simulate error from inputPort
    inputPortListeners['message']({
      data: { ok: false, error: 'Previous worker failed' },
    } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: false, error: 'Previous worker failed' },
      undefined,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('posts error to outputPort when workerFn throws in pipeline mode', async () => {
    const fn = vi.fn(() => {
      throw new Error('Pipeline error');
    });
    defineWorker(fn);

    const inputPortListeners: Record<string, (e: MessageEvent) => void> = {};
    const inputPort = {
      set onmessage(cb: (e: MessageEvent) => void) {
        inputPortListeners['message'] = cb;
      },
    };
    const outputPort = { postMessage: vi.fn() };

    listeners['message']({
      data: { __pipeline_ports__: true, inputPort, outputPort },
    } as MessageEvent);

    inputPortListeners['message']({
      data: { ok: true, data: 10 },
    } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    expect(outputPort.postMessage).toHaveBeenCalledWith({
      ok: false,
      error: 'Pipeline error',
    });
  });

  it('processes data using postMessage when outputPort is not provided in pipeline mode', async () => {
    const fn = vi.fn(({ data }: { data: number }) => data * 2);
    defineWorker(fn);

    const inputPortListeners: Record<string, (e: MessageEvent) => void> = {};
    const inputPort = {
      set onmessage(cb: (e: MessageEvent) => void) {
        inputPortListeners['message'] = cb;
      },
    };

    listeners['message']({
      data: { __pipeline_ports__: true, inputPort },
    } as MessageEvent);

    inputPortListeners['message']({
      data: { ok: true, data: 10 },
    } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: true, data: 20 },
      expect.anything(),
    );
  });

  it('extracts transferables and passes them to postMessage', async () => {
    const buffer = new ArrayBuffer(8);
    const fn = vi.fn(() => buffer);
    defineWorker(fn);

    listeners['message']({ data: { data: 5 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessageSpy).toHaveBeenCalledWith({ ok: true, data: buffer }, [
      buffer,
    ]);
  });
});
