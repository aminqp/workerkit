export interface SearchResult {
  id: string;
  title: string;
  score: number;
  source: string;
}

/**
 * Simulates a search shard that may fail entirely (e.g. a replica is down).
 * When `shouldFail` is true the worker throws, leaving that shard as rejected
 * in the `Promise.allSettled` result — the caller shows partial results.
 */
export function searchShard({
  data,
}: {
  data: {
    shardId: number;
    query: string;
    itemCount: number;
    shouldFail: boolean;
  };
}): SearchResult[] {
  const shard = Array.isArray(data) ? data[0] : data;
  const { shardId, query, itemCount, shouldFail } = shard;

  if (shouldFail) {
    throw new Error(`Shard ${shardId} unavailable — replica timeout`);
  }

  // Simulate search work
  const start = Date.now();
  while (Date.now() - start < 200 + Math.random() * 300) {
    /* spin */
  }

  const sources = ['web', 'news', 'images', 'docs', 'code'];
  return Array.from({ length: itemCount }, (_, i) => ({
    id: `shard${shardId}-result-${i + 1}`,
    title: `${query} — result ${i + 1} from shard ${shardId}`,
    score: parseFloat(Math.random().toFixed(4)),
    source: sources[Math.floor(Math.random() * sources.length)],
  })).sort((a, b) => b.score - a.score);
}

/**
 * Generates shard descriptors. Some shards are marked to fail so the UI
 * can demonstrate graceful partial-result handling.
 */
export function generateSearchShards({
  data,
}: {
  data: { shardCount: number; query: string; failEvery: number };
}): {
  shardId: number;
  query: string;
  itemCount: number;
  shouldFail: boolean;
}[] {
  const cfg = Array.isArray(data) ? data[0] : data;
  const { shardCount, query, failEvery } = cfg;
  return Array.from({ length: shardCount }, (_, i) => ({
    shardId: i + 1,
    query,
    itemCount: 20 + Math.floor(Math.random() * 30),
    shouldFail: (i + 1) % failEvery === 0, // every Nth shard fails
  }));
}
