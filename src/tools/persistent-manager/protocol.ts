/**
 * Message protocol between `PersistentWorkerManager` and persistent workers
 * (the generated persistent template and `defineWorker`).
 *
 * Requests carry the namespaced `__persistent__` marker so a worker that also
 * serves ordinary calls (a `defineWorker` script) never mistakes a normal
 * payload for a persistent request. `type` is kept alongside it for
 * hand-written workers that implemented the original `{ type: 'run' }` shape.
 *
 * Every request has an `id`; replies echo it so overlapping calls are matched
 * to the right caller regardless of the order in which they finish.
 */

export type PersistentOperation = 'run' | 'release';

export interface PersistentRequest {
  __persistent__: PersistentOperation;
  type: PersistentOperation;
  id?: string;
  config?: unknown;
  dataset?: unknown;
}

export interface PersistentReply {
  ok: boolean;
  id?: string;
  data?: unknown;
  error?: string;
  type?: 'released';
}

/** Error sent when a call arrives before any dataset has been cached. */
export const NO_DATASET_ERROR =
  'No dataset cached. Provide a dataset on the first call.';
