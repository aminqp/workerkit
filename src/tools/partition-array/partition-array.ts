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
  const chunkSize = Math.floor(array.length / chunks);
  const remainder = array.length % chunks;
  const result: T[][] = [];
  let start = 0;

  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    const size = chunkSize + (chunkIndex < remainder ? 1 : 0);
    result.push(array.slice(start, start + size));
    start += size;
  }

  return result;
}
