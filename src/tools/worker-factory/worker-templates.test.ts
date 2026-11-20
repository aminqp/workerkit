/**
 * Executes the generated worker scripts against a fake `self`, so the
 * templates are tested by behaviour rather than by string matching.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WorkerFactory, { WorkerMode } from './worker-factory';
import { NO_DATASET_ERROR } from '../persistent-manager/protocol';
import { forgetScriptUrls } from './script-url';
import { memoryWorkerScript } from '../memory-store/memory-worker';
import { memoryInput } from '../memory-input';
import { partitionArray } from '../partition-array';

type Listener = (event: { data: unknown; ports?: unknown[] }) => unknown;

interface FakeSelf {
  listeners: Listener[];
  posted: Array<{ message: Record<string, unknown>; transfer?: unknown[] }>;
  addEventListener: (type: string, listener: Listener) => void;
  postMessage: (message: Record<string, unknown>, transfer?: unknown[]) => void;
  close: ReturnType<typeof vi.fn>;
}

let generatedCode = '';

beforeEach(() => {
  vi.stubGlobal(
    'Blob',
    class {
      constructor(parts: string[]) {
        generatedCode = parts.join('');
      }
    },
  );
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:worker' });
  // Every boot() must generate (and capture) its own script.
  forgetScriptUrls();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Generates the script for `func` in `mode` and boots it with a fake `self`. */
function boot(func: (...args: never[]) => unknown, mode: WorkerMode) {
  new WorkerFactory(func as never, { mode });
  const self: FakeSelf = {
    listeners: [],
    posted: [],
    addEventListener: (_type, listener) => self.listeners.push(listener),
    postMessage: (message, transfer) => self.posted.push({ message, transfer }),
    close: vi.fn(),
  };
  new Function('self', generatedCode)(self);
  const send = async (data: unknown, ports: unknown[] = []) => {
    for (const listener of self.listeners) await listener({ data, ports });
  };
  return { self, send };
}

describe('Default template', () => {
  const funcs = {
    'expression arrow': ({ data }: { data: number[] }) =>
      data.map((n) => n * 2),
    'block arrow': ({ data }: { data: number[] }) => {
      return data.map((n) => n * 2);
    },
    'async arrow': async ({ data }: { data: number[] }) =>
      data.map((n) => n * 2),
    'function expression': function ({ data }: { data: number[] }) {
      return data.map((n) => n * 2);
    },
  };

  for (const [label, func] of Object.entries(funcs)) {
    it(`calls a ${label}`, async () => {
      const { self, send } = boot(func, WorkerMode.Default);
      await send({ data: [1, 2, 3] });
      expect(self.posted[0].message).toEqual({ ok: true, data: [2, 4, 6] });
    });
  }
});

describe('Persistent template', () => {
  const scale = ({ data, config }: { data: number[]; config: number }) =>
    data.map((n) => n * config);

  it('caches the dataset and echoes each request id', async () => {
    const { self, send } = boot(scale, WorkerMode.Persistent);
    await send({ __persistent__: 'run', id: 'a', dataset: [1, 2], config: 2 });
    await send({ __persistent__: 'run', id: 'b', config: 10 });
    expect(self.posted.map((p) => p.message)).toEqual([
      { ok: true, data: [2, 4], id: 'a' },
      { ok: true, data: [10, 20], id: 'b' },
    ]);
  });

  it('still accepts the legacy `type` field', async () => {
    const { self, send } = boot(scale, WorkerMode.Persistent);
    await send({ type: 'run', dataset: [3], config: 3 });
    expect(self.posted[0].message).toEqual({
      ok: true,
      data: [9],
      id: undefined,
    });
  });

  it('errors when no dataset has been cached', async () => {
    const { self, send } = boot(scale, WorkerMode.Persistent);
    await send({ __persistent__: 'run', id: 'x', config: 1 });
    expect(self.posted[0].message).toEqual({
      ok: false,
      error: NO_DATASET_ERROR,
      id: 'x',
    });
  });

  it('caches a dataset that is explicitly null', async () => {
    const { self, send } = boot(
      ({ data }: { data: unknown }) => data === null,
      WorkerMode.Persistent,
    );
    await send({ __persistent__: 'run', id: 'n', dataset: null, config: 0 });
    expect(self.posted[0].message).toMatchObject({ ok: true, data: true });
  });

  it('never transfers buffers that belong to the cached dataset', async () => {
    const { self, send } = boot(
      ({ data }: { data: Float64Array }) => ({
        view: data.subarray(1),
        fresh: new Float64Array(2),
      }),
      WorkerMode.Persistent,
    );
    const dataset = new Float64Array([1, 2, 3]);
    await send({ __persistent__: 'run', id: 't', dataset, config: 0 });

    const { transfer } = self.posted[0];
    expect(transfer).toHaveLength(1);
    expect(transfer).not.toContain(dataset.buffer);
  });

  it('closes itself on release', async () => {
    const { self, send } = boot(scale, WorkerMode.Persistent);
    await send({ __persistent__: 'release', type: 'release' });
    expect(self.close).toHaveBeenCalled();
    expect(self.posted[0].message).toMatchObject({ type: 'released' });
  });
});

describe('shared transferable extraction', () => {
  it('lists a buffer shared by several views only once', async () => {
    const { self, send } = boot(
      ({ data }: { data: Float64Array }) => ({
        head: data.subarray(0, 1),
        tail: data.subarray(1),
      }),
      WorkerMode.Default,
    );
    await send({ data: new Float64Array([1, 2, 3]) });
    expect(self.posted[0].transfer).toHaveLength(1);
  });
});

// ── reading input from the MemoryWorker ────────────────────────────────────

type PortHandler = (event: { data: unknown }) => void;

/** One end of a fake MessageChannel. */
interface FakePort {
  other: FakePort | null;
  listeners: Set<PortHandler>;
  onmessage: PortHandler | null;
  addEventListener(type: string, handler: PortHandler): void;
  removeEventListener(type: string, handler: PortHandler): void;
  start(): void;
  close(): void;
  postMessage(data: unknown): void;
}

/** Two connected fake MessagePorts, delivering cloned messages asynchronously. */
function fakeChannel() {
  const makePort = (): FakePort => ({
    other: null,
    listeners: new Set<PortHandler>(),
    onmessage: null,
    addEventListener(_type, handler) {
      this.listeners.add(handler);
    },
    removeEventListener(_type, handler) {
      this.listeners.delete(handler);
    },
    start() {},
    close() {},
    postMessage(data) {
      const target = this.other!;
      setTimeout(() => {
        const event = { data: structuredClone(data) };
        target.onmessage?.(event);
        target.listeners.forEach((handler) => handler(event));
      }, 0);
    },
  });
  const workerSide = makePort();
  const memorySide = makePort();
  workerSide.other = memorySide;
  memorySide.other = workerSide;
  return { workerSide, memorySide };
}

/** The last message a booted worker posted. */
const lastPosted = (self: FakeSelf) =>
  self.posted[self.posted.length - 1].message;

const settleAll = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * Boots the real MemoryWorker script, stores `rows` under ref "rows", and
 * returns a port registered with it plus a way to read stored values.
 */
async function bootMemoryWorker(rows: unknown) {
  const self = {
    listeners: [] as Listener[],
    posted: [] as Array<Record<string, unknown>>,
    addEventListener(_type: string, listener: Listener) {
      this.listeners.push(listener);
    },
    postMessage(message: Record<string, unknown>) {
      this.posted.push(message);
    },
  };
  new Function('self', memoryWorkerScript)(self);
  const send = (data: unknown, ports: unknown[] = []) =>
    self.listeners.forEach((listener) => listener({ data, ports }));

  send({ action: 'INIT_TOKEN', expectedToken: 'token' });
  send({
    action: 'SET',
    factoryToken: 'token',
    ref: 'rows',
    data: rows,
    id: 'set',
  });
  const { workerSide, memorySide } = fakeChannel();
  send({ action: 'REGISTER_PORT', factoryToken: 'token', id: 'reg' }, [
    memorySide,
  ]);

  const read = async (ref: string) => {
    send({ action: 'GET', factoryToken: 'token', ref, id: `read-${ref}` });
    return self.posted.find((m) => m.id === `read-${ref}`)?.data;
  };
  const describeRef = async (ref: string) => {
    send({
      action: 'DESCRIBE',
      factoryToken: 'token',
      ref,
      id: `describe-${ref}`,
    });
    return self.posted.find((m) => m.id === `describe-${ref}`);
  };
  return { port: workerSide, read, describeRef };
}

describe('MemoryWorker script', () => {
  it('GET_PART splits a stored array exactly like partitionArray', async () => {
    for (const length of [1, 2, 7, 10, 100, 101]) {
      const rows = Array.from({ length }, (_, i) => i);
      const { port } = await bootMemoryWorker(rows);
      for (const parts of [1, 2, 3, 4, 8]) {
        const count = Math.min(parts, length);
        const expected = partitionArray(rows, parts);
        for (let index = 0; index < count; index++) {
          const reply = await new Promise<Record<string, unknown>>(
            (resolve) => {
              port.addEventListener(
                'message',
                function handler(event: { data: unknown }) {
                  port.removeEventListener('message', handler);
                  resolve(event.data as Record<string, unknown>);
                },
              );
              port.postMessage({
                action: 'GET_PART',
                factoryToken: 'token',
                ref: 'rows',
                part: { index, count },
                id: 'part',
              });
            },
          );
          expect(
            reply.data,
            `length ${length}, ${parts} parts, part ${index}`,
          ).toEqual(expected[index]);
        }
      }
    }
  });

  it('DESCRIBE reports existence and array length without the data', async () => {
    const { describeRef } = await bootMemoryWorker([1, 2, 3]);
    expect(await describeRef('rows')).toMatchObject({
      ok: true,
      exists: true,
      isArray: true,
      length: 3,
    });
    expect((await describeRef('rows'))?.data).toBeUndefined();
    expect(await describeRef('missing')).toMatchObject({ exists: false });
  });
});

describe('Memory template: reading input from the MemoryWorker', () => {
  const stats = ({ data, mult }: { data: number[]; mult: number }) => ({
    sum: data.reduce((a, b) => a + b, 0) * mult,
    count: data.length,
  });

  it('reads its part of a stored array, then stores its result there', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const memory = await bootMemoryWorker(rows);
    const { self, send } = boot(stats, WorkerMode.Memory);

    await send({ __init_memory_port__: true, factoryToken: 'token' }, [
      memory.port,
    ]);
    await send({
      index: 1,
      mult: 2,
      data: memoryInput('rows', { index: 1, count: 3 }),
    });
    await settleAll();

    // partitionArray(rows, 3)[1] is [4, 5, 6]
    const reply = lastPosted(self);
    expect(reply).toMatchObject({
      ok: true,
      __memory_ref__: expect.any(String),
    });
    expect(await memory.read(reply.__memory_ref__ as string)).toEqual({
      sum: 30,
      count: 3,
    });
  });

  it('reads the whole stored value when there is no part', async () => {
    const memory = await bootMemoryWorker([1, 2, 3]);
    const { self, send } = boot(stats, WorkerMode.Memory);
    await send({ __init_memory_port__: true, factoryToken: 'token' }, [
      memory.port,
    ]);
    await send({ index: 0, mult: 1, data: memoryInput('rows') });
    await settleAll();

    const ref = lastPosted(self).__memory_ref__ as string;
    expect(await memory.read(ref)).toEqual({ sum: 6, count: 3 });
  });

  it('reports a missing ref as a failure', async () => {
    const memory = await bootMemoryWorker([1]);
    const { self, send } = boot(stats, WorkerMode.Memory);
    await send({ __init_memory_port__: true, factoryToken: 'token' }, [
      memory.port,
    ]);
    await send({ index: 0, mult: 1, data: memoryInput('gone') });
    await settleAll();

    expect(lastPosted(self)).toEqual({
      ok: false,
      error: 'Memory reference "gone" not found',
    });
  });
});

describe('Pipeline template: a first step that starts from a ref', () => {
  it('reads the stored value over a read-only port and posts its result on', async () => {
    const memory = await bootMemoryWorker([1, 2, 3]);
    const { self, send } = boot(
      ({ data }: { data: number[] }) => data.map((n) => n * 10),
      WorkerMode.Pipeline,
    );
    await send(
      { __init_memory_port__: true, factoryToken: 'token', storeResult: false },
      [memory.port],
    );
    await send({ data: memoryInput('rows'), index: 0 });
    await settleAll();

    expect(lastPosted(self)).toEqual({
      ok: true,
      data: [10, 20, 30],
    });
  });
});
