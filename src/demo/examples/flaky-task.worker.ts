export interface FlakyTaskResult {
  taskId: string;
  attempt: number;
  status: 'success' | 'failed';
  result?: string;
  error?: string;
}

/**
 * A task that randomly throws to simulate real-world flakiness
 * (network timeouts, transient DB errors, rate limits, etc.).
 * The worker config sets retries so the framework auto-retries failed shards.
 */
export function flakyTask({
  data,
}: {
  data: { taskId: string; failRate: number; workMs: number };
}): FlakyTaskResult {
  const task = Array.isArray(data) ? data[0] : data;
  const { taskId, failRate, workMs } = task;

  // Simulate work duration
  const start = Date.now();
  while (Date.now() - start < workMs) {
    /* spin */
  }

  // Randomly fail based on failRate (0–1)
  if (Math.random() < failRate) {
    throw new Error(`[${taskId}] Transient failure — connection reset`);
  }

  return {
    taskId,
    attempt: 1,
    status: 'success',
    result: `Processed in ${Date.now() - start} ms`,
  };
}

/**
 * Generates a batch of flaky task descriptors.
 * Some tasks have a high fail rate to guarantee retries are exercised.
 */
export function generateFlakyTasks({
  data,
}: {
  data: { count: number };
}): { taskId: string; failRate: number; workMs: number }[] {
  const count = Array.isArray(data) ? data[0].count : data.count;
  // Alternate between reliable (10% fail) and flaky (70% fail) tasks
  return Array.from({ length: count }, (_, i) => ({
    taskId: `flaky-${String(i + 1).padStart(3, '0')}`,
    failRate: i % 2 === 0 ? 0.1 : 0.7,
    workMs: 300 + Math.floor(Math.random() * 400),
  }));
}
