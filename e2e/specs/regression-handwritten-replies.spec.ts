import { test, expect, fulfilled } from './support';

test.describe('regression: replies from a hand-written last pipeline step', () => {
  for (const reply of ['ok', 'wrapped'] as const) {
    const shape = reply === 'ok' ? '{ ok: true, data }' : '{ data }';

    test(`single step replying ${shape}`, async ({ run }) => {
      const result = await run('handwrittenWorkers.pipelineSingleStep', reply);
      expect(result).toMatchObject(fulfilled({ data: [2, 3, 4] }));
    });

    test(`last of two steps replying ${shape}`, async ({ run }) => {
      const result = await run('handwrittenWorkers.pipelineLastStep', reply);
      expect(result).toMatchObject(fulfilled({ data: [3, 5, 7] }));
    });
  }

  // v1.0.0 returned undefined for a bare reply; it now comes back as-is.
  test('a bare reply (no ok, no data) is returned as-is', async ({ run }) => {
    expect(
      await run('handwrittenWorkers.pipelineSingleStep', 'raw'),
    ).toMatchObject(fulfilled({ data: [2, 3, 4] }));
    expect(
      await run('handwrittenWorkers.pipelineLastStep', 'raw'),
    ).toMatchObject(fulfilled({ data: [3, 5, 7] }));
  });
});

test.describe('regression: replies from a hand-written persistent worker', () => {
  test('a v1.0.0-protocol worker replying { data } (no ok, no id)', async ({
    run,
  }) => {
    const result = await run('handwrittenWorkers.persistent', 'wrapped');
    expect(result.withDataset).toMatchObject(fulfilled([2, 4, 6]));
    expect(result.fromCache).toMatchObject(fulfilled([3, 6, 9]));
  });

  // v1.0.0 returned undefined for a bare reply; it now comes back as-is.
  test('a bare reply (no ok, no data) is returned as-is', async ({ run }) => {
    const result = await run('handwrittenWorkers.persistent', 'raw');
    expect(result.withDataset).toMatchObject(fulfilled([2, 4, 6]));
    expect(result.fromCache).toMatchObject(fulfilled([3, 6, 9]));
  });
});
