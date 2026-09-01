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
