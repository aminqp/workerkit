import {
  setRunning,
  setStatus,
  setDone,
  setError,
  preview,
  Foreman,
} from '../ui-helpers';

export function initTransformCard(foreman: Foreman) {
  document.getElementById('btn-transform')!.onclick = async () => {
    const btn = document.getElementById('btn-transform') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('transform', btn);
    try {
      const { data: testData } = await foreman.runWorker('generateRandomData', {
        srcData: { count: 300000 },
      });
      setStatus(
        'transform',
        'running',
        `transforming ${testData.length} items…`,
      );
      const { data: result } = await foreman.runWorker('transformArray', {
        srcData: testData,
        options: {
          prefix: 'pre',
          suffix: 'suf',
          currency: 'USD',
          round: 'round',
          multiplier: 'multiplier',
        },
      });
      setDone(
        'transform',
        btn,
        performance.now() - begin,
        `${result.length} items transformed\n\n` + preview(result),
      );
    } catch (e) {
      setError('transform', btn, e);
    }
  };
}
