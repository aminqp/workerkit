/**
 * Persistent worker example: array transformation with cached dataset.
 *
 * The dataset (a large array) is sent once and cached inside the worker.
 * Only the config changes between calls — no need to re-send the data.
 *
 * Usage with `factory.runPersistent()`:
 *   1st call: { dataset: largeArray, config: { multiplier: 2, filter: 'even' } }
 *   2nd call: { config: { multiplier: 5, filter: 'odd' } }  ← dataset reused
 *   3rd call: { config: { multiplier: 1, filter: 'none' } } ← dataset reused
 */

export interface TransformConfig {
  /** Multiply each value by this factor */
  multiplier: number;
  /** Filter: 'even' | 'odd' | 'none' */
  filter: 'even' | 'odd' | 'none';
  /** Optional: only take first N items */
  limit?: number;
}

export interface TransformResult {
  items: number[];
  count: number;
  sum: number;
  avg: number;
  config: TransformConfig;
}

export function persistentTransform({
  data,
  config,
}: {
  data: number[];
  config: TransformConfig;
}): TransformResult {
  let items = data;

  // Apply filter
  if (config.filter === 'even') {
    items = items.filter((_, i) => i % 2 === 0);
  } else if (config.filter === 'odd') {
    items = items.filter((_, i) => i % 2 !== 0);
  }

  // Apply limit
  if (config.limit && config.limit > 0) {
    items = items.slice(0, config.limit);
  }

  // Apply multiplier
  items = items.map((n) => n * config.multiplier);

  // Compute stats
  const sum = items.reduce((acc, n) => acc + n, 0);

  return {
    items: items.slice(0, 10), // only send first 10 for display
    count: items.length,
    sum,
    avg: items.length > 0 ? Math.round((sum / items.length) * 100) / 100 : 0,
    config,
  };
}
