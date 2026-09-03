import { WorkerFunction } from '../main-worker-factory/types';

/** Shared extractTransferables helper embedded into every worker script. */
const EXTRACT_TRANSFERABLES_SRC = `
const extractTransferables = (value, seen = new Set()) => {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (value instanceof ArrayBuffer || value instanceof MessagePort ||
      (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
      (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)) {
    return [value];
  }
  if (ArrayBuffer.isView(value)) return [value.buffer];
  if (Array.isArray(value)) return value.flatMap(i => extractTransferables(i, seen));
  return Object.values(value).flatMap(v => extractTransferables(v, seen));
};
`;

/**
 * Generates the source code for an inline worker script that wraps a
 * serialized user function.
 *
 * The generated script:
 * 1. Embeds a self-contained copy of `extractTransferables` so transferable
 *    objects in the return value are moved (not cloned) back to the main thread.
 * 2. Listens for a single `message` event, calls the user function with the
 *    event data, and posts back `{ ok: true, data }` on success or
 *    `{ ok: false, error }` on failure.
 *
 * @param func - The stringified worker function (via `.toString()`).
 * @returns A self-contained JavaScript string ready to be turned into a
 *   `Blob` worker.
 */
const workerTemplate = (func: string) => `
${EXTRACT_TRANSFERABLES_SRC}
self.addEventListener('message', async (event) => {
  try {
    const output = await ${func}(event.data);
    self.postMessage({ ok: true, data: output }, extractTransferables(output));
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})
`;

/**
 * Generates a memory-aware worker script that stores its result **directly**
 * into the MemoryWorker thread via a pre-allocated `MessagePort`.
 *
 * Flow:
 * 1. Main thread sends an init message `{ __init_memory_port__: true, factoryToken }` with
 *    the worker-side MessagePort as a Transferable.
 * 2. Worker computes its result and posts it to the MemoryWorker via the port.
 * 3. MemoryWorker stores the data and returns a `__memory_ref__` token.
 * 4. Worker posts only `{ ok: true, __memory_ref__ }` back to the main thread.
 *
 * Large data never touches the main thread heap.
 *
 * @param func - The stringified worker function (via `.toString()`).
 */
const memoryWorkerTemplate = (func: string) => `
${EXTRACT_TRANSFERABLES_SRC}
const workerFn = ${func};
let memPort = null;
let factoryToken = null;
let pendingPayload = null;

async function runAndStore(payload) {
  try {
    const output = await workerFn(payload);
    if (!memPort) {
      // Fallback: no port provided, post data directly (legacy / opt-out path)
      self.postMessage({ ok: true, data: output }, extractTransferables(output));
      return;
    }
    // Store directly into MemoryWorker
    const ref = 'mem_' + crypto.randomUUID();
    await new Promise((resolve, reject) => {
      memPort.onmessage = (e) => {
        if (e.data && e.data.ref === ref) {
          if (e.data.ok) resolve(e.data.ref);
          else reject(new Error(e.data.error || 'MemoryWorker SET failed'));
        }
      };
      memPort.postMessage({ action: 'SET', factoryToken, ref, data: output });
    });
    // Only the token reaches the main thread
    self.postMessage({ ok: true, __memory_ref__: ref });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

self.addEventListener('message', async (event) => {
  // Init message: receive the MemoryWorker port and factory token
  if (event.data && event.data.__init_memory_port__) {
    memPort = event.ports[0] ?? event.data.memPort;
    factoryToken = event.data.factoryToken;
    if (memPort) memPort.start();
    // If a payload arrived before the port, process it now
    if (pendingPayload !== null) {
      const p = pendingPayload;
      pendingPayload = null;
      await runAndStore(p);
    }
    return;
  }
  // If port not yet received, queue the payload
  if (!memPort) {
    pendingPayload = event.data;
    return;
  }
  await runAndStore(event.data);
});
`;

/**
 * Generates a pipeline-aware worker script.
 *
 * This worker can:
 * - Receive pipeline port configuration via a `__pipeline_ports__` message
 * - Listen for input on an `inputPort` (from previous worker) or via `self`
 * - Forward output to an `outputPort` (to next worker) or back to main thread
 *
 * @param func - The stringified worker function (via `.toString()`).
 */
const pipelineWorkerTemplate = (func: string) => `
${EXTRACT_TRANSFERABLES_SRC}
const workerFn = ${func};
let outputPort = null;
let inputPort = null;
let pendingData = null;
let stepParams = {};

async function processData(data) {
  try {
    const payload =
      typeof data === 'object' && data !== null && 'data' in data
        ? { ...stepParams, ...data }
        : { data, ...stepParams, index: 0 };
    const output = await workerFn(payload);
    const result = { ok: true, data: output };
    const transfers = extractTransferables(output);
    if (outputPort) {
      outputPort.postMessage(result, transfers);
    } else {
      self.postMessage(result, transfers);
    }
  } catch (err) {
    const result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    if (outputPort) {
      outputPort.postMessage(result);
    } else {
      self.postMessage(result);
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.__pipeline_ports__) {
    if (event.data.stepParams) {
      stepParams = event.data.stepParams;
    }
    if (event.data.outputPort) {
      outputPort = event.data.outputPort;
    }
    if (event.data.inputPort) {
      inputPort = event.data.inputPort;
      inputPort.onmessage = (e) => {
        if (e.data && e.data.ok === false) {
          // Propagate errors through the pipeline
          if (outputPort) outputPort.postMessage(e.data);
          else self.postMessage(e.data);
        } else {
          processData({ data: e.data.data, ...stepParams, index: 0 });
        }
      };
    }
    // If we already received data before ports, process it now
    if (pendingData !== null) {
      processData(pendingData);
      pendingData = null;
    }
    return;
  }
  // First worker in pipeline or standalone — process directly
  if (!inputPort) {
    processData(event.data);
  } else {
    // Store data until ports are configured
    pendingData = event.data;
  }
});
`;

/**
 * Generates a persistent worker script that caches a dataset in memory.
 *
 * This worker:
 * - Stays alive between calls (no self-termination)
 * - Caches the `dataset` from the first call
 * - On subsequent calls, reuses the cached dataset if no new one is provided
 * - Responds to `{ type: 'release' }` by closing itself
 *
 * Message protocol:
 * - `{ type: 'run', dataset?: T, config: C }` — run with optional dataset update
 * - `{ type: 'release' }` — terminate the worker and free memory
 *
 * @param func - The stringified worker function (via `.toString()`).
 */
const persistentWorkerTemplate = (func: string) => `
${EXTRACT_TRANSFERABLES_SRC}
const workerFn = ${func};
let cachedDataset = null;

self.addEventListener('message', async (event) => {
  const msg = event.data;

  if (msg && msg.type === 'release') {
    cachedDataset = null;
    self.postMessage({ ok: true, data: null, type: 'released' });
    self.close();
    return;
  }

  if (msg && msg.type === 'run') {
    // Update cache if new dataset provided
    if (msg.dataset !== undefined) {
      cachedDataset = msg.dataset;
    }

    if (cachedDataset === null) {
      self.postMessage({ ok: false, error: 'No dataset cached. Provide a dataset on the first call.' });
      return;
    }

    try {
      const output = await workerFn({ data: cachedDataset, config: msg.config });
      self.postMessage({ ok: true, data: output }, extractTransferables(output));
    } catch (err) {
      self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // Fallback: treat as a regular one-shot call for backwards compat
  try {
    const output = await workerFn(msg);
    self.postMessage({ ok: true, data: output }, extractTransferables(output));
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
`;
export enum WorkerMode {
  Default = 'default',
  Pipeline = 'pipeline',
  Persistent = 'persistent',
  /**
   * Memory mode: the worker stores its result directly into the MemoryWorker
   * thread via a pre-allocated `MessagePort`. Only a `__memory_ref__` token
   * is posted back to the main thread — large data never touches main thread heap.
   */
  Memory = 'memory',
}

export interface WorkerFactoryOptions {
  /** The worker execution mode. Defaults to `WorkerMode.Default`. */
  mode?: WorkerMode;
  /** Factory function returning a native `Worker` instance. */
  createWorker?: () => Worker;
}

const TEMPLATES = Object.freeze({
  [WorkerMode.Persistent]: persistentWorkerTemplate,
  [WorkerMode.Pipeline]: pipelineWorkerTemplate,
  [WorkerMode.Default]: workerTemplate,
  [WorkerMode.Memory]: memoryWorkerTemplate,
});

/**
 * Low-level factory that serializes a {@link WorkerFunction} into a Blob URL
 * and spawns a native `Worker` from it.
 *
 * `WorkerFactory` is an internal building block used by `MainWorkerFactory`.
 * It handles the mechanics of turning a plain TypeScript function into a
 * runnable worker thread — you rarely need to use it directly.
 *
 * Supports three execution modes via {@link WorkerMode}:
 * - **Default** — one-shot worker that processes a single message and is
 *   terminated after responding.
 * - **Pipeline** — stays alive and forwards output to the next worker via
 *   `MessagePort`, enabling worker-to-worker data flow without main-thread
 *   round-trips.
 * - **Persistent** — stays alive indefinitely, caches a dataset in memory,
 *   and re-processes it with different configs on subsequent messages.
 *
 * The worker script is generated by the template corresponding to the chosen
 * mode, which wraps the function with a message listener and
 * transferable-extraction logic.
 */
class WorkerFactory {
  readonly _worker: Worker;

  /**
   * Creates a new `Worker` from the given function or factory option.
   *
   * @param workerFunction - The function to run inside the worker thread.
   *   Must be self-contained — it cannot reference variables from the outer
   *   scope because it is serialized via `.toString()`.
   * @param options - Optional configuration containing `createWorker` or `mode`.
   */
  constructor(workerFunction?: WorkerFunction, options?: WorkerFactoryOptions) {
    if (options?.createWorker) {
      this._worker = options.createWorker();
    } else if (workerFunction) {
      const mode = options?.mode ?? WorkerMode.Default;

      const workerCode: string = TEMPLATES[mode](workerFunction.toString());
      const workerBlob = new Blob([workerCode], {
        type: 'application/javascript',
      });

      this._worker = new Worker(URL.createObjectURL(workerBlob));
    } else {
      throw new Error(
        'Either workerFunction or options.createWorker must be provided to WorkerFactory.',
      );
    }
  }

  /**
   * Returns the underlying native `Worker` instance.
   *
   * Use this to attach `onmessage` / `onerror` handlers and call
   * `postMessage` / `terminate` directly.
   */
  get getWorker() {
    return this._worker;
  }
}

export default WorkerFactory;
