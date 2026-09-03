import { setStatus, setDone, Foreman } from '../ui-helpers';
import { runOnMainThread } from '../../examples/benchmark.worker.ts';

const BENCH_SIZE = 350;
const BENCH_COUNT = 6;

export function initBenchCard(foreman: Foreman) {
  document.getElementById('btn-bench')!.onclick = async () => {
    const btn = document.getElementById('btn-bench') as HTMLButtonElement;
    const mainEl = document.getElementById('bench-main-time')!;
    const workerEl = document.getElementById('bench-worker-time')!;
    const speedupEl = document.getElementById('bench-speedup')!;
    const barMain = document.getElementById('bench-bar-main')!;
    const barWorker = document.getElementById('bench-bar-worker')!;
    const resultEl = document.getElementById('result-bench')!;

    btn.disabled = true;
    setStatus('bench', 'running', 'step 1/2 — main thread (UI will freeze)…');
    mainEl.textContent = '…';
    workerEl.textContent = '…';
    speedupEl.textContent = '';
    resultEl.classList.remove('visible');

    await new Promise((r) => setTimeout(r, 60));

    const mainResult = runOnMainThread(BENCH_SIZE, BENCH_COUNT);

    setStatus(
      'bench',
      'running',
      'step 2/2 — worker threads (UI stays responsive)…',
    );
    mainEl.textContent = `${mainResult.totalMs} ms`;
    barMain.style.width = '100%';

    await new Promise((r) => setTimeout(r, 30));

    const tasks = Array.from({ length: BENCH_COUNT }, () => ({
      size: BENCH_SIZE,
    }));
    const workerStart = performance.now();
    const { data: workerTasks } = await foreman.runWorker('multiplyMatrices', {
      srcData: tasks,
    });
    const workerTotalMs = Math.round(performance.now() - workerStart);

    const speedup = (mainResult.totalMs / workerTotalMs).toFixed(2);
    workerEl.textContent = `${workerTotalMs} ms`;
    barWorker.style.width = `${Math.min(Math.round((workerTotalMs / mainResult.totalMs) * 100), 100)}%`;

    if (parseFloat(speedup) >= 1) {
      speedupEl.textContent = `${speedup}×  faster with workers`;
      speedupEl.style.color = 'rgba(50, 215, 75, 0.9)';
    } else {
      speedupEl.textContent = `tasks too fast — ${workerTotalMs - mainResult.totalMs} ms worker overhead`;
      speedupEl.style.color = 'rgba(255, 159, 10, 0.9)';
    }

    const lines = [
      `Matrix size   : ${BENCH_SIZE}×${BENCH_SIZE}`,
      `Tasks         : ${BENCH_COUNT}`,
      ``,
      `Main thread   : ${mainResult.totalMs} ms  (sequential, UI blocked)`,
      `  per task    : ${mainResult.perTaskMs.join(' ms,  ')} ms`,
      ``,
      `Worker threads: ${workerTotalMs} ms  (parallel, UI responsive)`,
      `  per task    : ${(workerTasks as { durationMs: number }[]).map((t) => t.durationMs).join(' ms,  ')} ms`,
      ``,
      `Speedup       : ${speedup}×`,
    ];
    setDone('bench', btn, workerTotalMs, lines.join('\n'));
  };
}
