/**
 * Helpers shared by harness scenarios. Everything a scenario returns must be
 * plain JSON so Playwright can hand it back to the spec.
 */

export type Outcome<T> =
  | { status: 'fulfilled'; value: T; ms: number }
  | { status: 'rejected'; error: string; ms: number }
  | { status: 'timeout'; ms: number };

/** Extracts a readable message from the many error shapes the library rejects with. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const shaped = err as {
      message?: unknown;
      reason?: unknown;
      failedResult?: { message?: unknown; type?: unknown };
      type?: unknown;
    };
    if (typeof shaped.message === 'string' && shaped.message)
      return shaped.message;
    if (shaped.reason !== undefined) return describeError(shaped.reason);
    if (shaped.failedResult) {
      if (typeof shaped.failedResult.message === 'string')
        return shaped.failedResult.message;
      return `event:${String(shaped.failedResult.type)}`;
    }
    if (typeof shaped.type === 'string') return `event:${shaped.type}`;
  }
  return String(err);
}

const TIMEOUT = Symbol('timeout');

/**
 * Awaits a promise but never hangs: a promise that does not settle within
 * `timeoutMs` is reported as `{ status: 'timeout' }`. This is how the suite
 * observes "this call never returns" bugs without stalling the test run.
 */
export async function settle<T>(
  promise: Promise<T>,
  timeoutMs = 4000,
): Promise<Outcome<T>> {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    if (result === TIMEOUT) return { status: 'timeout', ms: elapsed() };
    return { status: 'fulfilled', value: result as T, ms: elapsed() };
  } catch (err) {
    return { status: 'rejected', error: describeError(err), ms: elapsed() };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Records the arrival time of every message on a BroadcastChannel. Worker
 * functions post to the channel so the page can count attempts across
 * separate worker threads.
 */
export function listen(channelName: string) {
  const channel = new BroadcastChannel(channelName);
  const arrivals: number[] = [];
  channel.onmessage = () => arrivals.push(performance.now());
  return { arrivals, close: () => channel.close() };
}

/** Reduces a CollectedResult to JSON-safe fields. */
export function summarize(result: {
  data?: unknown;
  succeeded: number;
  failed: number;
  errors: unknown[];
  __memory_ref__?: string;
}) {
  return {
    hasDataKey: 'data' in result && result.data !== undefined,
    data: result.data,
    succeeded: result.succeeded,
    failed: result.failed,
    errors: result.errors.map(describeError),
    ref: result.__memory_ref__ ?? null,
  };
}

export type Summary = ReturnType<typeof summarize>;
