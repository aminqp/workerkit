import { test, expect, fulfilled } from './support';

test.describe('#14 several views of one buffer', () => {
  test('can be sent to a worker', async ({ run }) => {
    const outcome = await run('transfer.sendSharedViews');
    expect(outcome).toMatchObject(
      fulfilled({ data: [3, 7], succeeded: 1, failed: 0 }),
    );
  });

  test('can be returned by a worker to the next pipeline step', async ({
    run,
  }) => {
    const outcome = await run('transfer.returnSharedViews');
    expect(outcome).toMatchObject(fulfilled({ data: [3, 7] }));
  });
});
