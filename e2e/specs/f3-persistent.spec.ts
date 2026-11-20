import { test, expect, fulfilled, rejected } from './support';

test.describe('#3 overlapping runPersistent calls', () => {
  for (const order of ['slowFirst', 'fastFirst'] as const) {
    test(`each call gets its own result (${order})`, async ({ run }) => {
      const result = await run('persistent.overlappingCalls', order);
      expect(result.a).toMatchObject(fulfilled([2, 4, 6]));
      expect(result.b).toMatchObject(fulfilled([3, 6, 9]));
    });
  }

  test('a burst of slider-style calls all resolve correctly', async ({
    run,
  }) => {
    const outcomes = await run('persistent.sliderBurst');
    expect(outcomes).toHaveLength(8);
    outcomes.forEach((outcome: unknown, i: number) => {
      expect(outcome).toMatchObject(
        fulfilled([1, 2, 3].map((n) => n * (i + 1))),
      );
    });
  });

  test('release() rejects pending calls and drops the cache', async ({
    run,
  }) => {
    const result = await run('persistent.releaseWhilePending');
    expect(result.outcome).toMatchObject(rejected(/released/));
    expect(result.withoutDataset).toMatchObject(rejected(/No dataset cached/));
    expect(result.withDataset).toMatchObject(fulfilled([8]));
  });

  test('an uncaught error rejects the call but keeps the cache', async ({
    run,
  }) => {
    const result = await run('persistent.crashAfterSuccess');
    expect(result.seed).toMatchObject(fulfilled([1, 2]));
    expect(result.crashed).toMatchObject({ status: 'rejected' });
    expect(result.afterCrash).toMatchObject(fulfilled([2, 4]));
  });

  test('returning the cached typed array does not empty the cache (#13)', async ({
    run,
  }) => {
    const result = await run('persistent.typedArrayCacheSurvives');
    expect(result.first).toMatchObject(fulfilled([1, 2, 3, 4]));
    expect(result.second).toMatchObject(fulfilled([3, 4]));
  });

  test('a worker that fails to load fails every call instead of hanging', async ({
    run,
  }) => {
    const result = await run('persistent.brokenWorker');
    expect(result.first).toMatchObject({ status: 'rejected' });
    expect(result.second).toMatchObject({ status: 'rejected' });
  });
});
