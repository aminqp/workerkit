import { test, expect, fulfilled } from './support';

test.describe('regression: logging when the reducer falls back to the main thread', () => {
  test('a closure reducer still works and logs one error at the default level', async ({
    run,
  }) => {
    const { result, logged } = await run('reducerFallback.closureReducer');
    expect(result).toMatchObject(fulfilled({ data: [101, 102, 103] }));
    expect(
      logged.filter((entry: { level: string }) => entry.level === 'error'),
    ).toEqual([
      {
        level: 'error',
        message: expect.stringContaining(
          'Collect results reducer worker failed',
        ),
      },
    ]);
  });

  test('the fallback itself is logged at info level', async ({ run }) => {
    const { result, logged } = await run(
      'reducerFallback.closureReducer',
      'info',
    );
    expect(result).toMatchObject(fulfilled({ data: [101, 102, 103] }));
    expect(logged).toContainEqual({
      level: 'info',
      message: expect.stringContaining('merging on the main thread instead'),
    });
  });
});
