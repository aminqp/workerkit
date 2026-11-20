/**
 * Reads the result out of a worker's reply to the main thread.
 *
 * Inline and `defineWorker` workers reply `{ ok: true, data }`. A hand-written
 * worker may reply `{ data }` without `ok` — unwrapped the same way, as in
 * v1.0.0 — or a bare value, which is returned as-is.
 *
 * Used for the result of a pipeline's last step and of a persistent call.
 *
 * @param reply - The `data` of the worker's `message` event.
 * @returns The worker's result.
 */
export function replyData(reply: unknown): unknown {
  if (
    reply !== null &&
    typeof reply === 'object' &&
    ('ok' in reply || 'data' in reply)
  ) {
    return (reply as { data?: unknown }).data;
  }
  return reply;
}
