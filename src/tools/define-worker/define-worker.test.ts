import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineWorker } from './define-worker';
import { READS_MEMORY_INPUT, memoryInput } from '../memory-input';
import { partBounds } from '../partition-array';

/** A reply to the main thread: defineWorker marks it as able to read memory input. */
const replied = (message: Record<string, unknown>) => ({
  ...message,
  [READS_MEMORY_INPUT]: true,
});

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
      replied({ ok: true, data: 10 }),
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
      replied({ ok: true, data: 10 }),
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
    expect(postMessageSpy).toHaveBeenCalledWith(
      replied({ ok: true, data: 30 }),
      [],
    );
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
      replied({ ok: false, error: 'Sync error' }),
      undefined,
    );
  });

  it('handles asynchronous errors in workerFn', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Async error');
    });
    defineWorker(fn);

    listeners['message']({ data: { data: 10 } } as MessageEvent);
    // Let every pending promise settle (not a fixed number of ticks).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessageSpy).toHaveBeenCalledWith(
      replied({ ok: false, error: 'Async error' }),
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
      replied({ ok: false, error: 'String error' }),
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
      replied({ ok: true, data: 47 }),
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
      replied({ ok: true, data: 20 }),
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

    expect(postMessageSpy).toHaveBeenCalledWith(
      replied({ ok: true, data: buffer }),
      [buffer],
    );
  });

  describe('persistent mode (runPersistent)', () => {
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const send = (data: unknown) =>
      listeners['message']({ data } as MessageEvent);

    beforeEach(() => {
      (globalThis.self as unknown as { close: () => void }).close = vi.fn();
    });

    it('caches the dataset and passes { data, config } to the worker', async () => {
      const fn = vi.fn(
        ({ data, config }: { data: number[]; config: { mult: number } }) =>
          data.map((n) => n * config.mult),
      );
      defineWorker(fn);

      send({
        __persistent__: 'run',
        id: 'a',
        dataset: [1, 2],
        config: { mult: 2 },
      });
      await flush();
      send({ __persistent__: 'run', id: 'b', config: { mult: 10 } });
      await flush();

      expect(fn).toHaveBeenNthCalledWith(1, {
        data: [1, 2],
        config: { mult: 2 },
      });
      expect(fn).toHaveBeenNthCalledWith(2, {
        data: [1, 2],
        config: { mult: 10 },
      });
      expect(postMessageSpy).toHaveBeenNthCalledWith(
        1,
        { ok: true, data: [2, 4], id: 'a' },
        [],
      );
      expect(postMessageSpy).toHaveBeenNthCalledWith(
        2,
        { ok: true, data: [10, 20], id: 'b' },
        [],
      );
    });

    it('errors when no dataset has been cached', async () => {
      const fn = vi.fn();
      defineWorker(fn);

      send({ __persistent__: 'run', id: 'x', config: {} });
      await flush();

      expect(fn).not.toHaveBeenCalled();
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          ok: false,
          error: 'No dataset cached. Provide a dataset on the first call.',
          id: 'x',
        },
        undefined,
      );
    });

    it('does not transfer buffers that belong to the cached dataset', async () => {
      defineWorker(({ data }: { data: Float64Array }) => data.subarray(1));
      const dataset = new Float64Array([1, 2, 3]);

      send({ __persistent__: 'run', id: 't', dataset, config: {} });
      await flush();

      const [, transfer] = postMessageSpy.mock.calls[0];
      expect(transfer).toEqual([]);
    });

    it('clears the cache and closes on release', async () => {
      defineWorker(vi.fn());

      send({ __persistent__: 'release', type: 'release' });
      await flush();

      expect(postMessageSpy).toHaveBeenCalledWith(
        { ok: true, data: null, type: 'released', id: undefined },
        undefined,
      );
      expect(
        (globalThis.self as unknown as { close: () => void }).close,
      ).toHaveBeenCalled();
    });

    it('treats ordinary payloads with `type` and `config` as normal runs', async () => {
      const fn = vi.fn((params: unknown) => params);
      defineWorker(fn);

      send({ data: [1], type: 'run', config: { y: 2 } });
      await flush();

      expect(fn).toHaveBeenCalledWith({
        data: [1],
        type: 'run',
        config: { y: 2 },
      });
    });
  });

  describe('reading input from the MemoryWorker', () => {
    /** A fake port to a MemoryWorker holding `rows` under ref "rows". */
    function memoryPort(rows: number[]) {
      const handlers = new Set<(e: { data: unknown }) => void>();
      const stored = new Map<string, unknown>([['rows', rows]]);
      const port = {
        start: vi.fn(),
        addEventListener: (_t: string, h: (e: { data: unknown }) => void) =>
          handlers.add(h),
        removeEventListener: (_t: string, h: (e: { data: unknown }) => void) =>
          handlers.delete(h),
        postMessage: vi.fn((msg: Record<string, unknown>) => {
          let reply: Record<string, unknown>;
          if (msg.action === 'SET') {
            stored.set(msg.ref as string, msg.data);
            reply = { ok: true, ref: msg.ref, id: msg.id };
          } else {
            const value = stored.get(msg.ref as string) as number[] | undefined;
            const part = msg.part as
              | { index: number; count: number }
              | undefined;
            const data =
              part && value
                ? value.slice(
                    ...partBounds(value.length, part.count, part.index),
                  )
                : value;
            reply = {
              ok: true,
              exists: stored.has(msg.ref as string),
              data,
              id: msg.id,
            };
          }
          setTimeout(() => handlers.forEach((h) => h({ data: reply })), 0);
        }),
        stored,
      };
      return port;
    }
    const settle = () => new Promise((r) => setTimeout(r, 5));

    it('reads its part of a stored array and stores its result (runWorker)', async () => {
      const port = memoryPort([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const fn = vi.fn(({ data }: { data: number[] }) => data.length);
      defineWorker(fn);

      listeners['message']({
        data: { __init_memory_port__: true, factoryToken: 't' },
        ports: [port],
      } as unknown as MessageEvent);
      listeners['message']({
        data: { index: 2, data: memoryInput('rows', { index: 2, count: 3 }) },
      } as MessageEvent);
      await settle();

      // partitionArray(rows, 3)[2] is [7, 8, 9]
      expect(fn).toHaveBeenCalledWith({ index: 2, data: [7, 8, 9] });
      const calls = postMessageSpy.mock.calls;
      const reply = calls[calls.length - 1][0];
      expect(reply).toEqual(
        replied({ ok: true, __memory_ref__: expect.any(String) }),
      );
      expect(port.stored.get(reply.__memory_ref__)).toBe(3);
    });

    it('with a read-only port (a pipeline step) posts its result instead of storing it', async () => {
      const port = memoryPort([1, 2, 3]);
      defineWorker(({ data }: { data: number[] }) => data.map((n) => n * 2));

      listeners['message']({
        data: {
          __init_memory_port__: true,
          factoryToken: 't',
          storeResult: false,
        },
        ports: [port],
      } as unknown as MessageEvent);
      listeners['message']({
        data: { data: memoryInput('rows'), index: 0 },
      } as MessageEvent);
      await settle();

      expect(postMessageSpy).toHaveBeenLastCalledWith(
        replied({ ok: true, data: [2, 4, 6] }),
        [],
      );
    });

    it('reports a missing ref as a failure', async () => {
      const port = memoryPort([1]);
      defineWorker(vi.fn());
      listeners['message']({
        data: { __init_memory_port__: true, factoryToken: 't' },
        ports: [port],
      } as unknown as MessageEvent);
      listeners['message']({
        data: { index: 0, data: memoryInput('gone') },
      } as MessageEvent);
      await settle();

      expect(postMessageSpy).toHaveBeenLastCalledWith(
        replied({ ok: false, error: 'Memory reference "gone" not found' }),
        undefined,
      );
    });
  });
});
