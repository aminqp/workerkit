/**
 * Shared helpers for cancelling work when a `MainWorkerFactory` is terminated.
 *
 * Each factory owns an `AbortController` for its current run (from creation,
 * or from the last `reset()`, until the next `terminate()`). Every call
 * captures that run's `signal` when it starts, so a call that was cancelled
 * by `terminate()` stays cancelled even if `reset()` immediately starts a new
 * run — it can never retry or spawn workers in the new run.
 */

/** Message used for every rejection caused by termination. */
export const TERMINATED_MESSAGE = 'MainWorkerFactory has been terminated';

/** Creates the error every terminated call rejects with. */
export function terminatedError(): Error {
  return new Error(TERMINATED_MESSAGE);
}

/**
 * Runs `callback` once when `signal` aborts (immediately if it already has).
 *
 * @returns A function that removes the listener; call it once the guarded
 *          operation settles so finished work does not keep the listener alive.
 */
export function onAbort(signal: AbortSignal, callback: () => void): () => void {
  if (signal.aborted) {
    callback();
    return () => {};
  }
  signal.addEventListener('abort', callback, { once: true });
  return () => signal.removeEventListener('abort', callback);
}

/** Throws {@link terminatedError} if `signal` has been aborted. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw terminatedError();
}

/**
 * Marks a worker `error` event as handled.
 *
 * Without this, the browser also reports the worker's error as an uncaught
 * error on the page (`window.onerror`, error trackers, test runners) even
 * though the library has already turned it into a rejected promise.
 */
export function markErrorHandled(event: unknown): void {
  if (
    event &&
    typeof (event as Event).preventDefault === 'function' &&
    (event as Event).cancelable !== false
  ) {
    (event as Event).preventDefault();
  }
}

/** Builds an `Error` from a worker `error` event (or anything else thrown). */
export function errorFromEvent(event: unknown, fallback: string): Error {
  if (event instanceof Error) return event;
  const message = (event as ErrorEvent | undefined)?.message;
  return new Error(typeof message === 'string' && message ? message : fallback);
}
