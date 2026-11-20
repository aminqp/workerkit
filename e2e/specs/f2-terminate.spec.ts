import { test, expect, fulfilled, rejected } from './support';

test.describe('#2 calls still running when terminate() is called', () => {
  const cases = [
    ['runWorker', 'terminate.runWorkerInFlight'],
    ['multi-step pipeline', 'terminate.pipelineInFlight'],
    ['single-step pipeline', 'terminate.singleStepPipelineInFlight'],
    ['runPersistent', 'terminate.persistentInFlight'],
    ['runWorker during the merge step', 'terminate.reducerInFlight'],
  ] as const;

  for (const [label, scenario] of cases) {
    test(`${label} rejects promptly instead of hanging`, async ({ run }) => {
      const result = await run(scenario);
      expect(result.outcome).toMatchObject(rejected(/terminated/));
      expect(result.msAfterTerminate).toBeLessThan(500);
    });
  }

  test('a retrying call cancelled by reset() does not retry in the new run', async ({
    run,
  }) => {
    const result = await run('terminate.retryingCallThenReset');
    expect(result.outcome).toMatchObject(rejected(/terminated/));
    expect(result.attemptsBeforeReset).toBe(1);
    expect(result.attemptsAfterReset).toBe(0);
    expect(result.healthy).toMatchObject(fulfilled({ data: [1, 2] }));
  });
});
