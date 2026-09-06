import { setRunning, setDone, setError, preview } from '../ui-helpers';

import { foreman } from '../demo';

export function initExpCard() {
  document.getElementById('btn-exp1')!.onclick = async () => {
    const btn = document.getElementById('btn-exp1') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('exp1', btn);
    try {
      const { data } = await foreman.runWorker('exp1', {
        srcData: { seconds: 10 },
      });
      setDone(
        'exp1',
        btn,
        performance.now() - begin,
        preview([data] as unknown[]),
      );
    } catch (e) {
      setError('exp1', btn, e);
    }
  };
}
