/**
 * Pipeline benchmark: generate → heavy transform → aggregate
 *
 * Designed to show the real benefit of worker-to-worker pipelines.
 * The dataset is large (100k+ items with ~200-byte payloads each) so the
 * cost of serialising intermediate results back to the main thread is
 * measurable. In pipeline mode, only the final aggregate crosses to main.
 *
 * Traditional: Main → Worker A → Main → Worker B → Main → Worker C → Main
 *   (3 serialisation round-trips of large data)
 *
 * Pipeline:    Main → Worker A → Worker B → Worker C → Main
 *   (1 small result crosses to main)
 */

export interface RawRecord {
  id: number;
  value: number;
  category: string;
  timestamp: number;
  payload: string; // ~200 chars to make serialisation cost visible
}

export interface TransformedRecord {
  id: number;
  normalizedValue: number;
  category: string;
  dayOfWeek: string;
  hash: number;
  payloadLength: number;
}

export interface AggregateResult {
  totalRecords: number;
  avgNormalizedValue: number;
  byCategory: Record<string, { count: number; avgValue: number }>;
  byDay: Record<string, number>;
  topIds: number[];
}

/**
 * Step 1: Generate a large dataset with bulky payloads.
 * Each record has a ~200-char payload string to simulate real-world data size.
 */
export function generateLargeDataset({
  data,
}: {
  data: { count: number };
}): RawRecord[] {
  const CATEGORIES = [
    'electronics',
    'clothing',
    'food',
    'automotive',
    'healthcare',
    'finance',
    'education',
    'entertainment',
  ];

  const count = data.count;
  const records: RawRecord[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const seed = (i * 2654435761) >>> 0;
    records[i] = {
      id: i,
      value: (seed % 10000) / 100,
      category: CATEGORIES[seed % CATEGORIES.length],
      timestamp: 1700000000000 + (seed % 31536000000),
      payload: `record-${i}-${'x'.repeat(150 + (seed % 100))}`,
    };
  }

  return records;
}

/**
 * Step 2: CPU-heavy transformation.
 * Normalises values, computes hashes, extracts day-of-week.
 * Intentionally does extra work to simulate real processing.
 */
export function heavyTransform({
  data,
}: {
  data: RawRecord[];
}): TransformedRecord[] {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const results: TransformedRecord[] = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const record = data[i];

    // Compute a hash by iterating the payload
    let hash = 0;
    for (let j = 0; j < record.payload.length; j++) {
      hash = (hash * 31 + record.payload.charCodeAt(j)) | 0;
    }

    // Normalize value using sin/cos (intentionally expensive)
    const normalized =
      Math.abs(Math.sin(record.value) * Math.cos(record.value * 0.7)) * 100;

    const date = new Date(record.timestamp);

    results[i] = {
      id: record.id,
      normalizedValue: Math.round(normalized * 100) / 100,
      category: record.category,
      dayOfWeek: DAYS[date.getDay()],
      hash: hash >>> 0,
      payloadLength: record.payload.length,
    };
  }

  return results;
}

/**
 * Step 3: Aggregate transformed data into a summary.
 * Groups by category and day, finds top records.
 * Output is small — this is what crosses back to main thread.
 */
export function aggregateResults({
  data,
}: {
  data: TransformedRecord[];
}): AggregateResult {
  const byCategory: Record<string, { count: number; sum: number }> = {};
  const byDay: Record<string, number> = {};
  let totalValue = 0;

  for (const record of data) {
    totalValue += record.normalizedValue;

    if (!byCategory[record.category]) {
      byCategory[record.category] = { count: 0, sum: 0 };
    }
    byCategory[record.category].count++;
    byCategory[record.category].sum += record.normalizedValue;

    byDay[record.dayOfWeek] = (byDay[record.dayOfWeek] ?? 0) + 1;
  }

  const sorted = [...data].sort(
    (a, b) => b.normalizedValue - a.normalizedValue,
  );
  const topIds = sorted.slice(0, 5).map((r) => r.id);

  const categoryResult: Record<string, { count: number; avgValue: number }> =
    {};
  for (const [key, val] of Object.entries(byCategory)) {
    categoryResult[key] = {
      count: val.count,
      avgValue: Math.round((val.sum / val.count) * 100) / 100,
    };
  }

  return {
    totalRecords: data.length,
    avgNormalizedValue: Math.round((totalValue / data.length) * 100) / 100,
    byCategory: categoryResult,
    byDay,
    topIds,
  };
}
