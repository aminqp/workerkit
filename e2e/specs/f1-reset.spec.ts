import { test, expect, fulfilled } from './support';

test.describe('#1 reset() and restart() leave the factory usable', () => {
  for (const method of ['reset', 'restart'] as const) {
    test(`runWorker works after ${method}()`, async ({ run }) => {
      const result = await run('reset.runWorkerAfterReset', method);
      expect(result.before).toMatchObject(fulfilled({ data: [2, 4, 6, 8] }));
      expect(result.after).toMatchObject(
        fulfilled({ data: [10, 12], succeeded: 2, failed: 0 }),
      );
    });
  }

  test('memory APIs work after reset() and start empty', async ({ run }) => {
    const result = await run('reset.memoryApisAfterReset');
    expect(result.statsAfterReset).toMatchObject(
      fulfilled({ count: 0, refs: [] }),
    );
    expect(result.clear).toMatchObject({ status: 'fulfilled' });
    expect(result.stored).toMatchObject(
      fulfilled({ data: [14], ref: expect.any(String) }),
    );
    expect(result.statsAfterRun).toMatchObject(fulfilled({ count: 1 }));
  });

  test('pipeline and runPersistent work after reset()', async ({ run }) => {
    const result = await run('reset.pipelineAndPersistentAfterReset');
    expect(result.pipeline).toMatchObject(fulfilled({ data: [3, 5] }));
    expect(result.persistent).toMatchObject(fulfilled([9]));
  });
});
