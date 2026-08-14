import { describe, it, expect, vi } from 'vitest';
import { defineWorker } from './define-worker';

describe('defineWorker helper', () => {
  it('handles standard worker message execution', async () => {
    const fn = vi.fn(({ data }: { data: number }) => data * 2);

    // Simulate self inside worker
    const listeners: Record<string, (e: MessageEvent) => void> = {};
    const postMessageSpy = vi.fn();

    // Mock global self
    const origSelf = globalThis.self;
    (globalThis as unknown as Record<string, unknown>).self = {
      addEventListener: (type: string, cb: (e: MessageEvent) => void) => {
        listeners[type] = cb;
      },
      postMessage: postMessageSpy,
    };

    defineWorker(fn);

    // Simulate incoming message
    listeners['message']({ data: { data: 5 } } as MessageEvent);

    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith({ data: 5 });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { ok: true, data: 10 },
      expect.anything(),
    );

    // Restore self
    (globalThis as unknown as Record<string, unknown>).self = origSelf;
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
          (x) => (options?.prefix ?? '') + (configs?.multiplier ?? 1) * x,
        );
      },
    );

    const listeners: Record<string, (e: MessageEvent) => void> = {};
    const postMessageSpy = vi.fn();

    const origSelf = globalThis.self;
    (globalThis as unknown as Record<string, unknown>).self = {
      addEventListener: (type: string, cb: (e: MessageEvent) => void) => {
        listeners[type] = cb;
      },
      postMessage: postMessageSpy,
    };

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

    // Send __pipeline_ports__ message with stepParams
    listeners['message']({
      data: {
        __pipeline_ports__: true,
        stepParams: { configs: { multiplier: 3 }, options: { prefix: 'test' } },
        inputPort,
        outputPort,
      },
    } as MessageEvent);

    // Simulate data payload arriving on inputPort
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

    (globalThis as unknown as Record<string, unknown>).self = origSelf;
  });
});
