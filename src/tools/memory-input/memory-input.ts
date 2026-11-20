/**
 * Workers that read their input straight from the MemoryWorker.
 *
 * When a call's input is already in the MemoryWorker (a `__memory_ref__`),
 * the main thread does not fetch it and post it to every worker. Each worker
 * instead receives a small placeholder as its `data` —
 * `{ __memory_input__: { ref, part? } }` — and reads the value, or its
 * partition of it, over its own port to the MemoryWorker.
 *
 * Workers generated from `func` always do this. A bundled worker
 * (`createWorker`) does it only if it was written with `defineWorker`; such
 * workers say so by adding {@link READS_MEMORY_INPUT} to their replies, so
 * the first call to a bundled worker sends it the data and later calls let it
 * read for itself. Hand-written workers keep receiving the data itself.
 */

/** Key of the placeholder a worker replaces with the data it reads. */
export const MEMORY_INPUT = '__memory_input__';

/** Field a worker adds to its replies to say it reads memory input itself. */
export const READS_MEMORY_INPUT = '__reads_memory_input__';

/** Which stored value (and which partition of it) a worker should read. */
export interface MemoryInputSpec {
  ref: string;
  /** For partitioned calls: this worker's part, split like `partitionArray`. */
  part?: { index: number; count: number };
}

/** The placeholder a worker receives as `data` instead of the data itself. */
export function memoryInput(
  ref: string,
  part?: MemoryInputSpec['part'],
): Record<string, MemoryInputSpec> {
  return { [MEMORY_INPUT]: part ? { ref, part } : { ref } };
}

/** `createWorker` factories whose workers have said they read memory input. */
const knownReaders = new WeakSet<object>();

/**
 * Whether workers of `config` read their input from the MemoryWorker
 * themselves (see the module comment).
 */
export function readsMemoryInput(config: { createWorker?: unknown }): boolean {
  if (!config.createWorker) return true;
  return knownReaders.has(config.createWorker as object);
}

/** Records it when a bundled worker's reply says it reads memory input. */
export function noteMemoryInputReader(
  createWorker: unknown,
  reply: unknown,
): void {
  if (
    typeof createWorker === 'function' &&
    reply !== null &&
    typeof reply === 'object' &&
    (reply as Record<string, unknown>)[READS_MEMORY_INPUT] === true
  ) {
    knownReaders.add(createWorker);
  }
}
