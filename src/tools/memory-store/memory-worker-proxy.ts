import { memoryWorkerScript } from './memory-worker';
import { terminatedError } from '../lifecycle';
import { scriptUrl } from '../worker-factory/script-url';

/** Callbacks for a request waiting on a MemoryWorker reply, keyed by request ID. */
interface PendingRequest {
  resolve: (value: MessageEvent['data']) => void;
  reject: (reason: Error) => void;
}

/**
 * MemoryWorkerProxy provides a Promise-based API for communicating with the
 * dedicated `MemoryWorker` thread.
 *
 * It manages the worker's lifecycle, authenticates all requests with the
 * factory token, and exposes high-level methods for storing, retrieving,
 * and deleting datasets held off the main thread.
 *
 * The key method is `allocateWorkerPort()`, which creates a `MessageChannel`
 * and registers one port with the MemoryWorker so that a computing worker
 * or reducer worker can read/write data **directly** — without routing
 * through the main thread.
 *
 * Once {@link terminate} is called the proxy is permanently unusable: pending
 * requests reject, and every later call rejects immediately instead of
 * waiting for a reply that a terminated thread can never send.
 */
export class MemoryWorkerProxy {
  /** The MemoryWorker thread — `null` until the first request needs it. */
  private worker: Worker | null = null;
  private readonly factoryToken: string;
  private readonly pending = new Map<string, PendingRequest>();
  private terminated = false;

  /**
   * Creates the proxy. The MemoryWorker thread itself starts on the first
   * request, so a factory that is created but never used (for example an
   * extra instance from a React StrictMode render) costs no thread.
   */
  constructor(factoryToken: string) {
    this.factoryToken = factoryToken;
  }

  /** Whether {@link terminate} has been called. */
  get isTerminated(): boolean {
    return this.terminated;
  }

  /** Whether the MemoryWorker thread has been started. */
  get isStarted(): boolean {
    return this.worker !== null;
  }

  /** Returns the MemoryWorker, starting it on first use. */
  private startedWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(scriptUrl(memoryWorkerScript));
    worker.onmessage = (event) => {
      const { id } = event.data ?? {};
      const request = id ? this.pending.get(id) : undefined;
      if (request) {
        this.pending.delete(id);
        request.resolve(event.data);
      }
    };
    // Initialize the token handshake
    worker.postMessage({
      action: 'INIT_TOKEN',
      expectedToken: this.factoryToken,
    });
    this.worker = worker;
    return worker;
  }

  private send(
    action: string,
    payload: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ): Promise<MessageEvent['data']> {
    if (this.terminated) return Promise.reject(terminatedError());
    const worker = this.startedWorker();
    return new Promise((resolve, reject) => {
      const id = `req_${crypto.randomUUID()}`;
      this.pending.set(id, { resolve, reject });
      worker.postMessage(
        { action, factoryToken: this.factoryToken, id, ...payload },
        transfer,
      );
    });
  }

  /**
   * Answers a read-only request without starting the MemoryWorker when it is
   * not running yet — nothing can have been stored in it.
   */
  private answerWithoutStarting<T>(empty: T): Promise<T> | undefined {
    if (this.terminated) return Promise.reject(terminatedError());
    return this.worker ? undefined : Promise.resolve(empty);
  }

  /**
   * Stores a dataset in the MemoryWorker.
   *
   * @param data - The dataset to store.
   * @param ref - Optional ref ID; if omitted, MemoryWorker generates one.
   * @param transfer - Buffers to move to the MemoryWorker instead of copying.
   * @returns The ref ID under which the data is stored.
   */
  async set(
    data: unknown,
    ref?: string,
    transfer: Transferable[] = [],
  ): Promise<string> {
    const result = await this.send('SET', { data, ref }, transfer);
    if (!result.ok) throw new Error(result.error);
    return result.ref as string;
  }

  /**
   * Retrieves a dataset from the MemoryWorker by ref ID.
   *
   * @param ref - The ref ID to retrieve.
   * @returns The stored dataset, or `undefined` if not found.
   */
  async get(ref: string): Promise<unknown> {
    const idle = this.answerWithoutStarting<unknown>(undefined);
    if (idle) return idle;
    const result = await this.send('GET', { ref });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  /**
   * Describes a stored value without sending it: whether it exists, whether
   * it is an array, and its length — enough to plan partitions for workers
   * that will read their parts directly.
   *
   * @param ref - The ref ID to describe.
   */
  async describe(
    ref: string,
  ): Promise<{ exists: boolean; isArray: boolean; length?: number }> {
    const idle = this.answerWithoutStarting({ exists: false, isArray: false });
    if (idle) return idle;
    const result = await this.send('DESCRIBE', { ref });
    if (!result.ok) throw new Error(result.error);
    return {
      exists: Boolean(result.exists),
      isArray: Boolean(result.isArray),
      length: result.length as number | undefined,
    };
  }

  /**
   * Checks if a ref ID exists in the MemoryWorker.
   * @param ref - The ref ID to check.
   */
  async has(ref: string): Promise<boolean> {
    const idle = this.answerWithoutStarting(false);
    if (idle) return idle;
    const result = await this.send('GET', { ref });
    if (!result.ok) throw new Error(result.error);
    return Boolean(result.exists);
  }

  /**
   * Deletes a ref from the MemoryWorker.
   *
   * @param ref - The ref ID to delete.
   * @returns `true` if the ref existed and was deleted.
   */
  async delete(ref: string): Promise<boolean> {
    const idle = this.answerWithoutStarting(false);
    if (idle) return idle;
    const result = await this.send('DELETE', { ref });
    if (!result.ok) throw new Error(result.error);
    return Boolean(result.deleted);
  }

  /**
   * Clears all data from the MemoryWorker.
   */
  async clear(): Promise<void> {
    const idle = this.answerWithoutStarting<void>(undefined);
    if (idle) return idle;
    const result = await this.send('CLEAR');
    if (!result.ok) throw new Error(result.error);
  }

  /**
   * Returns statistics about data held in the MemoryWorker.
   */
  async stats(): Promise<{ count: number; refs: string[] }> {
    const idle = this.answerWithoutStarting({ count: 0, refs: [] as string[] });
    if (idle) return idle;
    const result = await this.send('STATS');
    if (!result.ok) throw new Error(result.error);
    return result.stats as { count: number; refs: string[] };
  }

  /**
   * Allocates a direct `MessagePort` to the MemoryWorker for a computing or
   * reducer worker.
   *
   * Creates a `MessageChannel` and registers one port with MemoryWorker via
   * `REGISTER_PORT`. The other port (the "worker-side" port) is returned as a
   * `Transferable` — it should be passed to the target worker via
   * `postMessage(..., [workerPort])` so the worker can communicate with
   * MemoryWorker directly without routing through the main thread.
   *
   * Resolves only after MemoryWorker has confirmed the registration.
   *
   * @returns The worker-side `MessagePort` ready to be transferred.
   */
  async allocateWorkerPort(): Promise<MessagePort> {
    const { port1: memoryWorkerPort, port2: workerPort } = new MessageChannel();
    const result = await this.send('REGISTER_PORT', {}, [memoryWorkerPort]);
    if (!result.ok) {
      workerPort.close();
      throw new Error(result.error);
    }
    return workerPort;
  }

  /**
   * Terminates the MemoryWorker thread. Pending requests reject with the
   * factory's termination error; later calls reject immediately.
   */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker?.terminate();
    const error = terminatedError();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
