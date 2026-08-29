/**
 * Memory Demo Workers
 *
 * Demonstrates transparent memory reference passing (memory & memoryOnly).
 * Producers return datasets which are offloaded to MemoryWorker.
 * Consumers receive datasets via `__memory_ref__` without worker code needing
 * any special memory handling APIs.
 */

export interface MemoryRecord {
  id: number;
  value: number;
  label: string;
}

/**
 * Producer 1: Configured with `memoryOnly: true`.
 * Generates a 250k item dataset. Main thread receives ONLY `{ __memory_ref__: 'mem_uuid_...' }`.
 */
export function generateMemoryData({
  data,
}: {
  data: { count: number };
}): MemoryRecord[] {
  const count = data?.count ?? 250000;
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    value: Math.round(Math.random() * 1000),
    label: `Item #${i + 1}`,
  }));
}

/**
 * Producer 2: Configured with `memory: true`.
 * Generates dataset and returns dataset + `__memory_ref__`.
 */
export function generateMemoryDataWithPayload({
  data,
}: {
  data: { count: number };
}): MemoryRecord[] {
  const count = data?.count ?? 50000;
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    value: i * 2,
    label: `Record #${i + 1}`,
  }));
}

/**
 * Consumer: Processes dataset.
 * Expects dataset as `data` — works standardly whether data comes from main thread
 * or resolved transparently from `__memory_ref__`.
 */
export function processMemoryData({
  data,
  options,
}: {
  data: MemoryRecord[];
  options?: { multiplier?: number };
}): { totalItems: number; sum: number; sample: MemoryRecord[] } {
  const multiplier = options?.multiplier ?? 2;
  const items = Array.isArray(data) ? data : [];
  let sum = 0;

  for (const item of items) {
    sum += item.value * multiplier;
  }

  return {
    totalItems: items.length,
    sum,
    sample: items.slice(0, 3),
  };
}
