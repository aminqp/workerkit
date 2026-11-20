import { test, expect, fulfilled } from './support';

test.describe('#9 worker functions written as arrow functions', () => {
  for (const kind of ['expression', 'block', 'async'] as const) {
    test(`${kind}-bodied arrow functions work in every mode`, async ({
      run,
    }) => {
      const result = await run('arrowFunctions.allModes', kind);
      expect(result.runWorker).toMatchObject(fulfilled({ data: [2, 4, 6] }));
      expect(result.singleStepPipeline).toMatchObject(
        fulfilled({ data: [2, 4, 6] }),
      );
      expect(result.twoStepPipeline).toMatchObject(
        fulfilled({ data: [4, 8, 12] }),
      );
      expect(result.persistent).toMatchObject(fulfilled([2, 4, 6]));
    });
  }
});
