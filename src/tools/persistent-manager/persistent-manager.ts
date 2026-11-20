import { WorkerFactory } from '../worker-factory';
import { WorkerMode } from '../worker-factory/worker-factory';
import { extractTransferable } from '../extract-transferable';
import {
  errorFromEvent,
  markErrorHandled,
  onAbort,
  terminatedError,
} from '../lifecycle';
import { replyData } from '../worker-reply';
import { WorkerConfig } from '../main-worker-factory/types';
import { PersistentManagerContext } from './types';
import { PersistentReply, PersistentRequest } from './protocol';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface PersistentEntry {
  worker: Worker;
  /** Calls waiting for a reply, in the order they were sent. */
  pending: Map<string, PendingCall>;
  /** Whether the worker has ever replied — i.e. it loaded successfully. */
  hasReplied: boolean;
}

/**
 * PersistentWorkerManager handles Web Workers that remain alive across multiple executions.
 *
 * Unlike transient workers which are terminated after a single run, persistent workers
 * maintain their internal state and memory context. This makes them ideal for tasks that
 * require heavy initialization, database connections, or large datasets.
 *
 * Responsibilities:
 * - Lazily instantiates persistent workers on first use and caches their instances.
 * - Routes execution requests to the correct running worker instance and matches each
 *   reply to its caller by request ID, so overlapping calls never mix up results.
 * - Rejects pending calls when a worker is released, crashes, or the factory terminates.
 * - Provides memory safety by explicitly releasing specific workers or all workers
 *   (`terminateAll`) when they are no longer needed.
 */
export class PersistentWorkerManager {
  private readonly _persistentWorkers: Map<string, PersistentEntry> = new Map();

  constructor(private context: PersistentManagerContext) {}

  async runPersistent<TResult = unknown>(
    workerName: string,
    params: { dataset?: unknown; config: unknown },
  ): Promise<TResult> {
    const signal = this.context.signal;
    if (this.context.isTerminated() || signal.aborted) {
      this.context.logger.error(
        'Attempted to run persistent worker after MainWorkerFactory was terminated',
      );
      throw terminatedError();
    }

    const config = this.context.findWorkerByName(workerName);
    if (!config) {
      this.context.logger.error(
        `Persistent worker config not found for worker: "${workerName}"`,
      );
      throw new Error(`Worker "${workerName}" not found`);
    }

    const entry = this.getOrCreate(workerName, config);
    const id = `run_${crypto.randomUUID()}`;

    return new Promise<TResult>((resolve, reject) => {
      const stopListening = onAbort(signal, () => {
        entry.pending.delete(id);
        reject(terminatedError());
      });
      entry.pending.set(id, {
        resolve: (value) => {
          stopListening();
          resolve(value as TResult);
        },
        reject: (reason) => {
          stopListening();
          reject(reason);
        },
      });

      const message: PersistentRequest = {
        __persistent__: 'run',
        type: 'run',
        id,
        config: params.config,
      };
      if (params.dataset !== undefined) {
        message.dataset = params.dataset;
      }
      try {
        entry.worker.postMessage(message, extractTransferable(message));
      } catch (err) {
        // e.g. DataCloneError: the dataset/config cannot be sent to a worker
        entry.pending.get(id)?.reject(errorFromEvent(err, String(err)));
        entry.pending.delete(id);
      }
    });
  }

  release(workerName: string): void {
    const entry = this._persistentWorkers.get(workerName);
    if (entry) {
      this.discard(
        workerName,
        entry,
        new Error(`Persistent worker "${workerName}" was released`),
      );
    }
  }

  terminateAll(): void {
    for (const [workerName, entry] of Array.from(this._persistentWorkers)) {
      this.discard(workerName, entry, terminatedError());
    }
  }

  private getOrCreate(workerName: string, config: WorkerConfig) {
    const existing = this._persistentWorkers.get(workerName);
    if (existing) return existing;

    const factory = new WorkerFactory(config.func, {
      mode: WorkerMode.Persistent,
      createWorker: config.createWorker,
    });
    const entry: PersistentEntry = {
      worker: this.context.trackWorker(factory.getWorker),
      pending: new Map(),
      hasReplied: false,
    };
    entry.worker.onmessage = (event) =>
      this.handleReply(workerName, entry, event.data);
    entry.worker.onerror = (event) =>
      this.handleError(workerName, entry, event);
    this._persistentWorkers.set(workerName, entry);
    this.context.logger.verbose(`Created persistent worker for ${workerName}`);
    return entry;
  }

  private handleReply(
    workerName: string,
    entry: PersistentEntry,
    reply: PersistentReply | undefined,
  ) {
    entry.hasReplied = true;
    if (reply?.type === 'released') return;

    // Replies echo the request ID. Hand-written workers that predate IDs are
    // answered in order: the oldest pending call gets the reply.
    const id =
      typeof reply?.id === 'string'
        ? reply.id
        : entry.pending.keys().next().value;
    const call = id === undefined ? undefined : entry.pending.get(id);
    if (!call || id === undefined) return;
    entry.pending.delete(id);

    if (reply?.ok === false) {
      this.context.logger.error(
        `Persistent worker ${workerName} failed`,
        reply.error,
      );
      call.reject(new Error(reply.error));
    } else {
      call.resolve(replyData(reply));
    }
  }

  private handleError(
    workerName: string,
    entry: PersistentEntry,
    event: Event,
  ) {
    markErrorHandled(event);
    this.context.logger.error(
      `Persistent worker ${workerName} encountered an error event`,
      event,
    );
    const error = errorFromEvent(
      event,
      `Persistent worker "${workerName}" failed`,
    );

    if (!entry.hasReplied) {
      // The worker never answered, so it failed to load: drop it so the next
      // call starts a fresh worker instead of waiting on a dead one forever.
      this.discard(workerName, entry, error);
      return;
    }

    // A live worker hit an uncaught error. The reply for any pending call may
    // never come, so reject them all — but keep the worker and its cache.
    for (const call of entry.pending.values()) call.reject(error);
    entry.pending.clear();
  }

  private discard(workerName: string, entry: PersistentEntry, reason: Error) {
    for (const call of entry.pending.values()) call.reject(reason);
    entry.pending.clear();
    try {
      entry.worker.postMessage({ __persistent__: 'release', type: 'release' });
    } catch {
      // Ignore — the worker may already be gone
    }
    this.context.terminateWorker(entry.worker);
    if (this._persistentWorkers.get(workerName) === entry) {
      this._persistentWorkers.delete(workerName);
    }
  }
}
