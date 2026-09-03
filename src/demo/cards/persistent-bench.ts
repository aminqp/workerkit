import { setStatus, setDone, setError } from '../ui-helpers';
import type { Foreman } from '../ui-helpers';

export function initPersistentBenchCard(foreman: Foreman) {
  document.getElementById('btn-persistent-bench')!.onclick = async () => {
    const btn = document.getElementById(
      'btn-persistent-bench',
    ) as HTMLButtonElement;
    const traditionalEl = document.getElementById('persist-traditional-time')!;
    const persistentEl = document.getElementById('persist-persistent-time')!;
    const speedupEl = document.getElementById('persist-speedup')!;
    const barTraditional = document.getElementById('persist-bar-traditional')!;
    const barPersistent = document.getElementById('persist-bar-persistent')!;
    const resultEl = document.getElementById('result-persistent-bench')!;

    btn.disabled = true;
    setStatus('persistent-bench', 'running', 'generating dataset…');
    traditionalEl.textContent = '…';
    persistentEl.textContent = '…';
    speedupEl.textContent = '';
    barTraditional.style.width = '0%';
    barPersistent.style.width = '0%';
    resultEl.classList.remove('visible');

    const DATASET_SIZE = 200000;
    const CONFIGS = [
      { multiplier: 2, filter: 'even' as const },
      { multiplier: 5, filter: 'odd' as const },
      { multiplier: 3, filter: 'none' as const },
      { multiplier: 7, filter: 'even' as const, limit: 10000 },
      { multiplier: 1, filter: 'none' as const, limit: 50000 },
    ];

    const dataset = Array.from({ length: DATASET_SIZE }, () =>
      Math.round(Math.random() * 1000),
    );

    try {
      // ── Traditional: re-send dataset every time via runWorker ──
      setStatus(
        'persistent-bench',
        'running',
        'traditional: sending full dataset × 5 configs…',
      );
      const traditionalStart = performance.now();

      for (const config of CONFIGS) {
        await foreman.runWorker('persistentTransform', {
          srcData: dataset,
          config,
        });
      }

      const traditionalMs = Math.round(performance.now() - traditionalStart);
      traditionalEl.textContent = `${traditionalMs} ms`;
      barTraditional.style.width = '100%';

      // ── Persistent: send dataset once, then only configs ──
      setStatus(
        'persistent-bench',
        'running',
        'persistent: dataset once + 5 config-only calls…',
      );
      await new Promise((r) => setTimeout(r, 30));

      const persistentStart = performance.now();

      // First call: send dataset
      await foreman.runPersistent('persistentTransform', {
        dataset,
        config: CONFIGS[0],
      });

      // Remaining calls: config only (dataset cached)
      for (let i = 1; i < CONFIGS.length; i++) {
        await foreman.runPersistent('persistentTransform', {
          config: CONFIGS[i],
        });
      }

      const persistentMs = Math.round(performance.now() - persistentStart);
      persistentEl.textContent = `${persistentMs} ms`;
      barPersistent.style.width = `${Math.min(Math.round((persistentMs / traditionalMs) * 100), 100)}%`;

      // Release the persistent worker
      foreman.release('persistentTransform');

      // ── Speedup display ──
      const savings = traditionalMs - persistentMs;
      const speedup = (traditionalMs / persistentMs).toFixed(2);
      const dataTransferred = Math.round(
        (DATASET_SIZE * 8 * CONFIGS.length) / 1024 / 1024,
      );
      const dataSaved = Math.round(
        (DATASET_SIZE * 8 * (CONFIGS.length - 1)) / 1024 / 1024,
      );

      if (savings > 0) {
        speedupEl.textContent = `${speedup}×  faster with persistent caching`;
        speedupEl.style.color = 'rgba(50, 215, 75, 0.9)';
      } else {
        speedupEl.textContent = `${-savings} ms overhead (try larger dataset)`;
        speedupEl.style.color = 'rgba(255, 159, 10, 0.9)';
      }

      const lines = [
        `Dataset: ${DATASET_SIZE.toLocaleString()} numbers`,
        `Configs: ${CONFIGS.length} variations`,
        '',
        `Traditional (${CONFIGS.length}× full dataset transfer): ${traditionalMs} ms`,
        `  Data transferred: ~${dataTransferred} MB total`,
        '',
        `Persistent (1× dataset + ${CONFIGS.length - 1}× config only): ${persistentMs} ms`,
        `  Data saved: ~${dataSaved} MB (${CONFIGS.length - 1} transfers skipped)`,
        '',
        savings > 0
          ? `Saved ${savings} ms (${speedup}× faster)`
          : `Overhead: ${-savings} ms`,
      ];

      setDone(
        'persistent-bench',
        btn,
        traditionalMs + persistentMs,
        lines.join('\n'),
      );
    } catch (e) {
      setError('persistent-bench', btn, e);
    }
  };
}
