/**
 * A pure CPU-bound function — matrix multiplication.
 * Chosen because it's deterministic, has no I/O, and scales predictably.
 * Running N of these on the main thread takes N × singleMs.
 * Running N via MainWorkerFactory takes ≈ singleMs (all parallel).
 */
export function multiplyMatrices({ data }: { data: { size: number } }): {
  size: number;
  durationMs: number;
  checksum: number;
} {
  const cfg = Array.isArray(data) ? data[0] : data;
  const { size } = cfg;
  const start = Date.now();

  // Build two random size×size matrices
  const a = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Math.random()),
  );
  const b = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Math.random()),
  );

  // Multiply: O(n³)
  let checksum = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      let sum = 0;
      for (let k = 0; k < size; k++) sum += a[i][k] * b[k][j];
      checksum += sum;
    }
  }

  return { size, durationMs: Date.now() - start, checksum };
}

/**
 * Runs multiplyMatrices directly on the calling thread (main thread).
 * Returns total wall-clock time for running `count` multiplications sequentially.
 *
 * @param size - The size of the matrix.
 * @param count - The number of multiplications to run.
 */
export function runOnMainThread(
  size: number,
  count: number,
): {
  totalMs: number;
  perTaskMs: number[];
  avgMs: number;
} {
  const perTaskMs: number[] = [];
  const wallStart = Date.now();

  for (let i = 0; i < count; i++) {
    const r = multiplyMatrices({ data: { size } });
    perTaskMs.push(r.durationMs);
  }

  const totalMs = Date.now() - wallStart;
  return { totalMs, perTaskMs, avgMs: Math.round(totalMs / count) };
}
