import { test, expect, fulfilled, rejected } from './support';

test.describe('#4 runPersistent with bundled defineWorker workers', () => {
  test('caches the dataset between calls and replaces it on demand', async ({
    run,
  }) => {
    const result = await run('defineWorkerPersistent.cachesDataset');
    expect(result.first).toMatchObject(fulfilled([2, 4, 6]));
    expect(result.second).toMatchObject(fulfilled([10, 20, 30]));
    expect(result.replaced).toMatchObject(fulfilled([15]));
    expect(result.afterReplace).toMatchObject(fulfilled([10]));
  });

  test('the first call must provide a dataset', async ({ run }) => {
    const outcome = await run('defineWorkerPersistent.requiresDatasetFirst');
    expect(outcome).toMatchObject(rejected(/No dataset cached/));
  });

  test('overlapping calls each get their own result', async ({ run }) => {
    const result = await run('defineWorkerPersistent.overlappingCalls');
    expect(result.a).toMatchObject(fulfilled([2, 4, 6]));
    expect(result.b).toMatchObject(fulfilled([3, 6, 9]));
  });

  test('release() frees the cache; the next call starts fresh', async ({
    run,
  }) => {
    const result = await run('defineWorkerPersistent.releaseAndRecreate');
    expect(result.withoutDataset).toMatchObject(rejected(/No dataset cached/));
    expect(result.withDataset).toMatchObject(fulfilled([14]));
  });

  test('a normal runWorker call with `type` and `config` params is unaffected', async ({
    run,
  }) => {
    const outcome = await run('defineWorkerPersistent.regularRunUnaffected');
    expect(outcome).toMatchObject(
      fulfilled({ data: [{ data: { x: 1 }, type: 'run', config: { y: 2 } }] }),
    );
  });
});
