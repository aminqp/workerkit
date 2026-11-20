import { test, expect, readReadme } from './support';

test.describe('#5 partitioned vs unpartitioned runs, and the README Quick Start', () => {
  test('the README Quick Start prints what it claims', async ({ run }) => {
    const readme = readReadme();
    const quickStart = readme.slice(
      readme.indexOf('## Quick Start'),
      readme.indexOf('\n---', readme.indexOf('## Quick Start')),
    );
    const claimed = quickStart.match(/console\.log\(data\);\s*\/\/\s*(.+)$/m);
    expect(claimed, 'Quick Start shows its expected output').not.toBeNull();

    // The scenario mirrors the README config; make sure they have not drifted.
    expect(quickStart).toContain('partition: true');
    expect(quickStart).toContain('reducer:');

    const result = await run('partition.quickStartCorrected');
    expect(result.data).toEqual(JSON.parse(claimed![1]));
  });

  test('the v1.0.0 Quick Start config returns one result per thread', async ({
    run,
  }) => {
    const result = await run('partition.quickStartAsPublished');
    expect(result).toEqual({ data: [15, 15, 15, 15], succeeded: 4 });
  });

  test('partitioned runs split the input without duplicating it', async ({
    run,
  }) => {
    const result = await run('partition.partitionedNoDuplicates');
    expect(result).toEqual({ matchesInput: true, succeeded: 4 });
  });

  test('partitioned runs never start more threads than items', async ({
    run,
  }) => {
    const result = await run('partition.fewerItemsThanThreads');
    expect(result).toMatchObject({ data: [1, 2], succeeded: 2 });
  });

  test('unpartitioned runs repeat the full input on every thread maxConcurrency asks for', async ({
    run,
  }) => {
    const result = await run('partition.unpartitionedReplicates');
    expect(result).toMatchObject({ data: [1, 2, 1, 2, 1, 2], succeeded: 3 });
  });

  test('without maxConcurrency, input that is not split runs once; partitioned input uses every core', async ({
    run,
  }) => {
    const result = await run('partition.defaultThreads');
    // v1.0.0 ran these on every core: [15, 15, …] and [{ a: 1 }, { a: 1 }, …]
    expect(result.notPartitioned).toMatchObject({ data: [15], succeeded: 1 });
    expect(result.notAnArray).toMatchObject({
      data: [{ a: 1 }],
      succeeded: 1,
    });
    expect(result.partitioned).toEqual({
      succeeded: Math.min(result.cores, 1000),
      matchesInput: true,
    });
  });
});
