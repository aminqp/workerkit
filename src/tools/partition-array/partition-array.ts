/**
 * Partitions a flat array into a specified number of smaller chunks.
 *
 * This is used to distribute a large dataset across multiple worker threads.
 * If the array length is not perfectly divisible by `numChunks`, the remainder
 * elements are distributed evenly across the first few chunks (1 extra element per chunk).
 *
 * @typeParam T - The type of elements within the array.
 * @param array - The array to be partitioned.
 * @param numChunks - The desired number of sub-arrays (chunks).
 * @returns An array containing the partitioned sub-arrays. If the input array is empty, returns `[]`.
 * @throws If `numChunks` is less than or equal to 0.
 */
export function partitionArray<T>(array: T[], numChunks: number): T[][] {
  if (!array.length) return [];
  if (numChunks <= 0) throw new Error('numChunks must be positive');

  const chunks = Math.min(numChunks, array.length);
  return Array.from({ length: chunks }, (_, chunkIndex) => {
    const [start, end] = partBounds(array.length, chunks, chunkIndex);
    return array.slice(start, end);
  });
}

/**
 * Start and end (exclusive) of part `index` when `length` items are split
 * into `parts` parts the way {@link partitionArray} splits them: as equal as
 * possible, with the first `length % parts` parts one item larger.
 *
 * Self-contained on purpose: it is also embedded into the MemoryWorker's
 * script, so a worker that reads its part from the MemoryWorker gets exactly
 * the slice `partitionArray` would have given it.
 *
 * @param length - Number of items being split.
 * @param parts - Number of parts (at most `length`).
 * @param index - Which part, from 0.
 * @returns `[start, end)` indices into the array.
 */
export function partBounds(
  length: number,
  parts: number,
  index: number,
): [number, number] {
  const size = Math.floor(length / parts);
  const remainder = length % parts;
  const start = index * size + Math.min(index, remainder);
  return [start, start + size + (index < remainder ? 1 : 0)];
}
