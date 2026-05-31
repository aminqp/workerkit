import { setRunning, setDone, setError, preview } from '../ui-helpers';
import type { Foreman } from '../ui-helpers';

export function initGenCard(foreman: Foreman) {
  document.getElementById('btn-gen')!.onclick = async () => {
    const btn = document.getElementById('btn-gen') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('gen', btn);
    try {
      const res = await foreman.runWorker('generateRandomData', {
        srcData: { count: 300000 },
      });
      const { data } = await foreman.collectResults(res);
      setDone(
        'gen',
        btn,
        performance.now() - begin,
        `${data.length} items generated\n\n` + preview(data),
      );
    } catch (e) {
      setError('gen', btn, e);
    }
  };
}
