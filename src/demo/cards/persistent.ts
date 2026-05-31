import {
  setRunning,
  setStatus,
  setDone,
  setError,
  setResult,
  Foreman,
} from '../ui-helpers';
import type { TransformResult } from '../../examples/persistent-transform.worker.ts';

export function initPersistentCard(foreman: Foreman) {
  let rerunCount = 0;

  document.getElementById('btn-persistent')!.onclick = async () => {
    const btn = document.getElementById('btn-persistent') as HTMLButtonElement;
    const releaseBtn = document.getElementById(
      'btn-persistent-release',
    ) as HTMLButtonElement;
    const begin = performance.now();
    setRunning('persistent', btn);

    const DATASET_SIZE = 50000;

    try {
      // Generate dataset
      const dataset = Array.from({ length: DATASET_SIZE }, () =>
        Math.round(Math.random() * 1000),
      );

      // Run 1: send dataset + config (dataset gets cached)
      setStatus('persistent', 'running', 'run 1: sending dataset + config…');
      const t1Start = performance.now();
      const r1: TransformResult = await foreman.runPersistent(
        'persistentTransform',
        {
          dataset,
          config: { multiplier: 2, filter: 'even' },
        },
      );
      const t1 = Math.round(performance.now() - t1Start);

      // Run 2: only config (dataset reused from cache)
      setStatus('persistent', 'running', 'run 2: config only (cached data)…');
      const t2Start = performance.now();
      const r2: TransformResult = await foreman.runPersistent(
        'persistentTransform',
        {
          config: { multiplier: 5, filter: 'odd' },
        },
      );
      const t2 = Math.round(performance.now() - t2Start);

      // Run 3: only config again
      setStatus('persistent', 'running', 'run 3: config only (cached data)…');
      const t3Start = performance.now();
      const r3: TransformResult = await foreman.runPersistent(
        'persistentTransform',
        {
          config: { multiplier: 1, filter: 'none', limit: 1000 },
        },
      );
      const t3 = Math.round(performance.now() - t3Start);

      releaseBtn.disabled = false;
      const rerunBtn = document.getElementById(
        'btn-persistent-rerun',
      ) as HTMLButtonElement;
      rerunBtn.disabled = false;

      const lines = [
        `Dataset: ${DATASET_SIZE.toLocaleString()} numbers (sent once, cached in worker)`,
        '',
        `Run 1 (dataset + config):  ${t1} ms`,
        `  filter: even, multiplier: 2`,
        `  → ${r1.count.toLocaleString()} items, sum: ${r1.sum.toLocaleString()}, avg: ${r1.avg}`,
        `  preview: [${r1.items.join(', ')}…]`,
        '',
        `Run 2 (config only):       ${t2} ms  ← no dataset transfer`,
        `  filter: odd, multiplier: 5`,
        `  → ${r2.count.toLocaleString()} items, sum: ${r2.sum.toLocaleString()}, avg: ${r2.avg}`,
        `  preview: [${r2.items.join(', ')}…]`,
        '',
        `Run 3 (config only):       ${t3} ms  ← no dataset transfer`,
        `  filter: none, limit: 1000, multiplier: 1`,
        `  → ${r3.count.toLocaleString()} items, sum: ${r3.sum.toLocaleString()}, avg: ${r3.avg}`,
        `  preview: [${r3.items.join(', ')}…]`,
        '',
        `Total: ${Math.round(performance.now() - begin)} ms`,
        `Runs 2 & 3 skipped ~${Math.round((DATASET_SIZE * 8) / 1024)} KB of dataset serialization each`,
      ];

      setDone('persistent', btn, performance.now() - begin, lines.join('\n'));
    } catch (e) {
      setError('persistent', btn, e);
    }
  };

  document.getElementById('btn-persistent-release')!.onclick = () => {
    foreman.release('persistentTransform');
    const btn = document.getElementById(
      'btn-persistent-release',
    ) as HTMLButtonElement;
    const rerunBtn = document.getElementById(
      'btn-persistent-rerun',
    ) as HTMLButtonElement;
    btn.disabled = true;
    rerunBtn.disabled = true;
    setStatus('persistent', 'done', 'worker released — memory freed');
  };

  // Re-run persistent worker with a new random config (no dataset transfer)
  document.getElementById('btn-persistent-rerun')!.onclick = async () => {
    const btn = document.getElementById(
      'btn-persistent-rerun',
    ) as HTMLButtonElement;
    btn.disabled = true;
    rerunCount++;

    const filters: Array<'even' | 'odd' | 'none'> = ['even', 'odd', 'none'];
    const randomConfig = {
      multiplier: Math.floor(Math.random() * 10) + 1,
      filter: filters[Math.floor(Math.random() * filters.length)],
      limit:
        Math.random() > 0.5
          ? Math.floor(Math.random() * 5000) + 100
          : undefined,
    };

    setStatus(
      'persistent',
      'running',
      `re-run #${rerunCount}: config only (no dataset transfer)…`,
    );

    try {
      const start = performance.now();
      const result: TransformResult = await foreman.runPersistent(
        'persistentTransform',
        { config: randomConfig },
      );
      const elapsed = Math.round(performance.now() - start);

      const lines = [
        `Re-run #${rerunCount} — config only (0 bytes dataset transferred)`,
        `  Time: ${elapsed} ms`,
        `  Config: multiplier=${randomConfig.multiplier}, filter=${randomConfig.filter}${randomConfig.limit ? `, limit=${randomConfig.limit}` : ''}`,
        `  → ${result.count.toLocaleString()} items, sum: ${result.sum.toLocaleString()}, avg: ${result.avg}`,
        `  preview: [${result.items.join(', ')}…]`,
      ];

      setStatus(
        'persistent',
        'done',
        `re-run #${rerunCount} done in ${elapsed} ms`,
      );
      setResult('persistent', lines.join('\n'));
      btn.disabled = false;
    } catch (e) {
      setError('persistent', btn, e);
      btn.disabled = false;
    }
  };
}
