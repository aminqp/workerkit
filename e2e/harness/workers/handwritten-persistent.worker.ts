/**
 * A hand-written persistent worker written against the v1.0.0 protocol: it
 * reads `type: 'run' | 'release'`, caches the `dataset` itself, and replies
 * `{ data }` — no `ok`, no request `id` — or the bare array when
 * `config.reply` is `'raw'`.
 */
let cached: number[] = [];

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message?.type === 'release') {
    self.close();
    return;
  }
  if (message?.type !== 'run') return;
  if (message.dataset !== undefined) cached = message.dataset;
  const output = cached.map((n) => n * message.config.mult);
  self.postMessage(message.config.reply === 'raw' ? output : { data: output });
};
