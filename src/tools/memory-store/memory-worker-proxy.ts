import { memoryWorkerScript } from './memory-worker';

/**
 * Pending request callbacks keyed by request ID.
 */
type PendingResolve = (value: MessageEvent['data']) => void;

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
 */
export class MemoryWorkerProxy {
  private readonly worker: Worker;
  private readonly factoryToken: string;
  private readonly pending = new Map<string, PendingResolve>();

  constructor(factoryToken: string) {
    this.factoryToken = factoryToken;

    const blob = new Blob([memoryWorkerScript], {
      type: 'application/javascript',
    });
    this.worker = new Worker(URL.createObjectURL(blob));

    this.worker.onmessage = (event) => {
      const { id } = event.data ?? {};
      if (id && this.pending.has(id)) {
        const resolve = this.pending.get(id)!;
        this.pending.delete(id);
        resolve(event.data);
      }
    };

    // Initialize the token handshake
    this.worker.postMessage({
      action: 'INIT_TOKEN',
      expectedToken: factoryToken,
    });
  }

  private send(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<MessageEvent['data']> {
    return new Promise((resolve) => {
      const id = `req_${crypto.randomUUID()}`;
      this.pending.set(id, resolve);
      this.worker.postMessage({
        action,
        factoryToken: this.factoryToken,
        id,
        ...payload,
      });
    });
  }

  /**
   * Stores a dataset in the MemoryWorker.
   *
   * @param data - The dataset to store.
   * @param ref - Optional ref ID; if omitted, MemoryWorker generates one.
   * @returns The ref ID under which the data is stored.
   */
  async set(data: unknown, ref?: string): Promise<string> {
    const result = await this.send('SET', { data, ref });
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
    const result = await this.send('GET', { ref });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  /**
   * Checks if a ref ID exists in the MemoryWorker.
   * @param ref - The ref ID to check.
   */
  async has(ref: string): Promise<boolean> {
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
    const result = await this.send('DELETE', { ref });
    if (!result.ok) throw new Error(result.error);
    return Boolean(result.deleted);
  }

  /**
   * Clears all data from the MemoryWorker.
   */
  async clear(): Promise<void> {
    const result = await this.send('CLEAR');
    if (!result.ok) throw new Error(result.error);
  }

  /**
   * Returns statistics about data held in the MemoryWorker.
   */
  async stats(): Promise<{ count: number; refs: string[] }> {
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
   * @returns The worker-side `MessagePort` ready to be transferred.
   */
  async allocateWorkerPort(): Promise<MessagePort> {
    const channel = new MessageChannel();
    const { port1: memWorkerPort, port2: workerPort } = channel;

    const id = `req_${crypto.randomUUID()}`;
    this.pending.set(id, () => {}); // ACK, no payload needed

    // Transfer port1 to MemoryWorker so it listens on it
    this.worker.postMessage(
      {
        action: 'REGISTER_PORT',
        factoryToken: this.factoryToken,
        id,
      },
      [memWorkerPort],
    );

    // Small settle to ensure the port is registered before returning
    await new Promise<void>((resolve) => {
      const originalResolve = this.pending.get(id)!;
      this.pending.set(id, (data) => {
        originalResolve(data);
        resolve();
      });
    });

    return workerPort;
  }

  /**
   * Terminates the MemoryWorker thread and clears all pending requests.
   */
  terminate(): void {
    this.pending.clear();
    this.worker.terminate();
  }
}
