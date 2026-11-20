import { test, expect, fulfilled } from './support';

test.describe('#6 memory and memoryOnly results', () => {
  test('memoryOnly returns only the ref, and the ref can be consumed', async ({
    run,
  }) => {
    const result = await run('memory.memoryOnlyReturnsOnlyRef');
    expect(result.produced.hasDataKey).toBe(false);
    expect(result.produced.ref).toEqual(expect.any(String));
    expect(result.statsAfterProduce).toBe(1);
    expect(result.consumed).toMatchObject(
      fulfilled({ data: [result.expectedSum] }),
    );
    expect(result.statsAfterConsume).toBe(0);
  });

  test('memory returns the data and a ref holding the same data', async ({
    run,
  }) => {
    const result = await run('memory.memoryReturnsDataAndRef');
    expect(result.dataLength).toBe(1000);
    expect(result.hasRef).toBe(true);
    expect(result.consumed).toMatchObject(
      fulfilled({ data: [result.expectedSum] }),
    );
  });

  for (const steps of [1, 2] as const) {
    test(`a ${steps}-step pipeline can start from a memory ref`, async ({
      run,
    }) => {
      const result = await run('memory.pipelineConsumesRef', steps);
      expect(result.outcome).toMatchObject(
        fulfilled({ data: result.expectedSum }),
      );
    });
  }
});
