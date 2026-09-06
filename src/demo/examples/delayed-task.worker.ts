export interface DelayedTaskResult {
  taskId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  payload: unknown;
}

/**
 * Simulates a long-running delayed task — e.g. a report generation job,
 * a polling loop waiting for an external service, or a scheduled batch job.
 *
 * Blocks the worker thread for `delayMs` milliseconds (busy-wait so it's
 * truly CPU-visible, not just a timer), then returns a result envelope.
 */
export function runDelayedTask({
  data,
}: {
  data:
    | { taskId: string; delayMs: number; payload: unknown }
    | { taskId: string; delayMs: number; payload: unknown }[];
}): DelayedTaskResult {
  // when partitioned, each shard arrives as a single-element array
  const task = Array.isArray(data) ? data[0] : data;
  const { taskId, delayMs, payload } = task;

  const startedAt = new Date().toISOString();
  const start = Date.now();

  while (Date.now() - start < delayMs) {
    /* intentional spin */
  }

  return {
    taskId,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
    payload,
  };
}

/**
 * Generates a batch of delayed task descriptors with varying delays.
 */
export function generateDelayedTasks({
  data: { count, minMs = 2000, maxMs = 8000 },
}: {
  data: { count: number; minMs?: number; maxMs?: number };
}): { taskId: string; delayMs: number; payload: unknown }[] {
  const categories = ['report', 'export', 'sync', 'backup', 'index'];
  return Array.from({ length: count }, (_, i) => ({
    taskId: `task-${String(i + 1).padStart(4, '0')}`,
    delayMs: Math.floor(Math.random() * (maxMs - minMs) + minMs),
    payload: {
      category: categories[i % categories.length],
      recordCount: Math.floor(Math.random() * 50000) + 1000,
      priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
    },
  }));
}
