import {
  setRunning,
  setStatus,
  setDone,
  setError,
  preview,
  Foreman,
} from '../ui-helpers';

export function initListCard(foreman: Foreman) {
  document.getElementById('btn-list')!.onclick = async () => {
    const btn = document.getElementById('btn-list') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('list', btn);
    try {
      const genRes = await foreman.runWorker(
        'generateListTransformArrayTestData',
        { srcData: { count: 30000 } },
      );
      const { data: testData } = await foreman.collectResults(genRes);
      setStatus('list', 'running', `transforming ${testData.length} records…`);
      const transformRes = await foreman.runWorker('listTransformArray', {
        srcData: testData,
      });
      const { data: result } = await foreman.collectResults(transformRes);
      setDone(
        'list',
        btn,
        performance.now() - begin,
        `${result.length} records transformed\n\n` + preview(result),
      );
    } catch (e) {
      setError('list', btn, e);
    }
  };
}
