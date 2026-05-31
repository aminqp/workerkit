import { setRunning, setDone, setError, preview } from '../ui-helpers';
import type { Foreman } from '../ui-helpers';

export function initExpCard(foreman: Foreman) {
  document.getElementById('btn-exp1')!.onclick = async () => {
    const btn = document.getElementById('btn-exp1') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('exp1', btn);
    try {
      const res = await foreman.runWorker('exp1', { srcData: { seconds: 10 } });
      const { data } = await foreman.collectResults(res);
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
