import { test, expect, readRepoFile } from './support';

test.describe('#7 retries', () => {
  test('a failing worker runs 3 times by default (1 try + 2 retries)', async ({
    run,
  }) => {
    const { attempts, result } = await run('retries.countAttempts', null);
    expect(attempts).toBe(3);
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 1,
      errors: ['always fails'],
    });
  });

  for (const retries of [0, 1]) {
    test(`retries: ${retries} runs ${retries + 1} time(s)`, async ({ run }) => {
      const { attempts } = await run('retries.countAttempts', retries);
      expect(attempts).toBe(retries + 1);
    });
  }

  test('the README documents the real default', () => {
    const row = readRepoFile('README.md')
      .split('\n')
      .find((line) => line.startsWith('| `retries`'));
    expect(row).toBeDefined();
    expect(row!.split('|')[3].trim()).toBe('`2`');
  });
});
