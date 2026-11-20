/**
 * The MemoryWorker as a data hub: input enters it once and workers read it
 * (or their partition of it) directly. `traffic` is the JSON size of every
 * message between the main thread and any worker during the call.
 */
import { test, expect, fulfilled } from './support';

const ROWS = 20_001;

/** What partitionArray gives each of `parts` workers for `length` items. */
function partSizes(length: number, parts: number) {
  const count = Math.min(parts, length);
  const size = Math.floor(length / count);
  return Array.from(
    { length: count },
    (_, i) => size + (i < length % count ? 1 : 0),
  );
}

/** Stats a worker returns for rows [first, last]. */
function statsFor(first: number, last: number) {
  let sum = 0;
  for (let id = first; id <= last; id++) sum += id % 97;
  return { count: last - first + 1, sum, first, last };
}

/** Expected stats per partition. */
function partitionStats(length: number, parts: number) {
  let first = 0;
  return partSizes(length, parts).map((size) => {
    const stats = statsFor(first, first + size - 1);
    first += size;
    return stats;
  });
}

test.describe('MemoryWorker as a data hub', () => {
  test('a partitioned run from a ref: each worker reads only its part, nothing crosses the main thread', async ({
    run,
  }) => {
    const result = await run('memoryHub.partitionedFromRef', ROWS);
    expect(result.failed).toBe(0);
    expect(result.shards).toEqual(partitionStats(ROWS, 4));
    expect(result.traffic).toBeLessThan(result.datasetBytes * 0.05);
    expect(result.stored).toBe(0);
  });

  test('an unpartitioned run from a ref: every thread reads the whole input', async ({
    run,
  }) => {
    const result = await run('memoryHub.wholeFromRef', ROWS);
    const whole = statsFor(0, ROWS - 1);
    expect(result.shards).toEqual([whole, whole, whole]);
    expect(result.traffic).toBeLessThan(result.datasetBytes * 0.05);
  });

  test('the same srcData for 3 threads leaves the main thread once, not 3 times', async ({
    run,
  }) => {
    const result = await run('memoryHub.fanOut', ROWS);
    const whole = statsFor(0, ROWS - 1);
    expect(result.shards).toEqual([whole, whole, whole]);
    expect(result.traffic).toBeLessThan(result.datasetBytes * 1.2);
    expect(result.stored).toBe(0);
  });

  test('a typed array sent to 3 threads reaches all of them', async ({
    run,
  }) => {
    const sum = (999 * 1000) / 2;
    expect(await run('memoryHub.fanOutTypedArray')).toMatchObject(
      fulfilled({ data: [sum, sum, sum], failed: 0 }),
    );
  });

  test('a pipeline started from a ref: the first step reads it directly', async ({
    run,
  }) => {
    const result = await run('memoryHub.pipelineFromRef', ROWS);
    expect(result.stats).toEqual(statsFor(0, ROWS - 1));
    expect(result.traffic).toBeLessThan(result.datasetBytes * 0.05);
    expect(result.stored).toBe(0);
  });

  test('setMemory once, then three jobs read the same data: it crosses the main thread once', async ({
    run,
  }) => {
    const result = await run('memoryHub.setMemoryOnce', ROWS);
    const whole = statsFor(0, ROWS - 1);
    expect(result.parts).toEqual(partitionStats(ROWS, 4));
    expect(result.whole).toEqual([whole, whole, whole]);
    expect(result.piped).toEqual(whole);
    // getMemory reads it back once more, on purpose
    expect(result.roundTrip).toBe(ROWS);
    expect(result.traffic).toBeLessThan(result.datasetBytes * 2.2);
    expect(result.stored).toBe(0);
  });

  test('a bundled defineWorker worker reads from the MemoryWorker once it has identified itself', async ({
    run,
  }) => {
    const { runs, datasetBytes } = await run('memoryHub.bundledFromRef', ROWS);
    const expected = partitionStats(ROWS, 4);
    expect(runs[0].result).toEqual(expected);
    expect(runs[1].result).toEqual(expected);
    // The first call learns that the worker can read by ref.
    expect(runs[1].traffic).toBeLessThan(datasetBytes * 0.05);
  });

  test('a hand-written worker still receives its data from the main thread', async ({
    run,
  }) => {
    expect(await run('memoryHub.handwrittenFromRef', ROWS)).toMatchObject(
      fulfilled(partitionStats(ROWS, 4)),
    );
  });
});
