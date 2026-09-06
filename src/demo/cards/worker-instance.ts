import { setRunning, setDone, setError } from '../ui-helpers';
import { foreman } from '../demo';

export function initWorkerInstanceCard() {
  const btn = document.getElementById(
    'btn-worker-instance',
  ) as HTMLButtonElement | null;
  if (!btn) return;

  btn.onclick = async () => {
    const begin = performance.now();
    setRunning('worker-instance', btn);
    try {
      const { data } = await foreman.runWorker('webpackCreateWorker', {
        srcData: {
          message: 'Hello from createWorker factory pattern!',
          timestamp: new Date().toISOString(),
        },
      });
      const lines = [
        'createWorker execution completed successfully across threads:',
        '',
        JSON.stringify(data, null, 2),
      ];
      setDone(
        'worker-instance',
        btn,
        performance.now() - begin,
        lines.join('\n'),
      );
    } catch (e) {
      setError('worker-instance', btn, e);
    }
  };
}
