/**
 * A hand-written runWorker worker (no `defineWorker`): it ignores the
 * library's MemoryWorker init message and replies `{ ok, data }` itself, so
 * it can only work with data posted to it by the main thread.
 */
interface StatsRow {
  id: number;
  value: number;
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message?.__init_memory_port__) return;
  const rows = message.data as StatsRow[];
  self.postMessage({
    ok: true,
    data: {
      count: rows.length,
      sum: rows.reduce((acc, row) => acc + row.value, 0),
      first: rows.length ? rows[0].id : -1,
      last: rows.length ? rows[rows.length - 1].id : -1,
    },
  });
};
