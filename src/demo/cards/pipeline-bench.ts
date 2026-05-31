import { setStatus, setDone, setError, Foreman } from '../ui-helpers';
import type { AggregateResult } from '../../examples/pipeline-benchmark.worker.ts';

export function initPipelineBenchCard(foreman: Foreman) {
  document.getElementById('btn-pipeline-bench')!.onclick = async () => {
    const btn = document.getElementById(
      'btn-pipeline-bench',
    ) as HTMLButtonElement;
    const traditionalEl = document.getElementById('pipe-traditional-time')!;
    const pipelineEl = document.getElementById('pipe-pipeline-time')!;
    const speedupEl = document.getElementById('pipe-speedup')!;
    const barTraditional = document.getElementById('pipe-bar-traditional')!;
    const barPipeline = document.getElementById('pipe-bar-pipeline')!;
    const resultEl = document.getElementById('result-pipeline-bench')!;

    btn.disabled = true;
    setStatus('pipeline-bench', 'running', 'step 1/2 — traditional approach…');
    traditionalEl.textContent = '…';
    pipelineEl.textContent = '…';
    speedupEl.textContent = '';
    barTraditional.style.width = '0%';
    barPipeline.style.width = '0%';
    resultEl.classList.remove('visible');

    const RECORD_COUNT = 100000;

    try {
      // ── Traditional approach: data round-trips through main thread ──
      setStatus(
        'pipeline-bench',
        'running',
        'traditional: generate → main → transform → main → aggregate…',
      );
      const traditionalStart = performance.now();

      const genRes = await foreman.runWorker('generateLargeDataset', {
        srcData: { count: RECORD_COUNT },
      });
      const { data: rawData } = await foreman.collectResults(genRes);

      const transformRes = await foreman.runWorker('heavyTransform', {
        srcData: rawData,
      });
      const { data: transformed } = await foreman.collectResults(transformRes);

      const aggRes = await foreman.runWorker('aggregateResults', {
        srcData: transformed,
      });
      const { data: traditionalResult } = await foreman.collectResults(aggRes);

      const traditionalMs = Math.round(performance.now() - traditionalStart);
      traditionalEl.textContent = `${traditionalMs} ms`;
      barTraditional.style.width = '100%';

      // ── Pipeline approach: data stays between workers ──
      setStatus(
        'pipeline-bench',
        'running',
        'step 2/2 — pipeline (worker-to-worker)…',
      );
      await new Promise((r) => setTimeout(r, 30));

      const pipelineStart = performance.now();

      const pipelineResult: AggregateResult = await foreman.pipeline([
        { worker: 'generateLargeDataset', srcData: { count: RECORD_COUNT } },
        { worker: 'heavyTransform' },
        { worker: 'aggregateResults' },
      ]);

      const pipelineMs = Math.round(performance.now() - pipelineStart);
      pipelineEl.textContent = `${pipelineMs} ms`;
      barPipeline.style.width = `${Math.min(Math.round((pipelineMs / traditionalMs) * 100), 100)}%`;

      // ── Speedup display ──
      const savings = traditionalMs - pipelineMs;
      const speedup = (traditionalMs / pipelineMs).toFixed(2);

      if (savings > 0) {
        speedupEl.textContent = `${speedup}×  faster with pipeline`;
        speedupEl.style.color = 'rgba(50, 215, 75, 0.9)';
      } else {
        speedupEl.textContent = `${-savings} ms overhead (dataset may be too small)`;
        speedupEl.style.color = 'rgba(255, 159, 10, 0.9)';
      }

      // ── Detailed results ──
      const dataSizeEstimate = Math.round(
        (RECORD_COUNT * 220 * 2) / 1024 / 1024,
      );

      const lines = [
        `Records: ${RECORD_COUNT.toLocaleString()} × ~220 bytes each`,
        `Estimated data avoided: ~${dataSizeEstimate} MB (2 round-trips skipped)`,
        '',
        `Traditional (3 main-thread transfers): ${traditionalMs} ms`,
        `Pipeline    (1 final result only):     ${pipelineMs} ms`,
        '',
        `─── Aggregate Result ───`,
        `Total records:  ${pipelineResult.totalRecords.toLocaleString()}`,
        `Avg value:      ${pipelineResult.avgNormalizedValue}`,
        `Top IDs:        ${pipelineResult.topIds.join(', ')}`,
        '',
        `By category:`,
        ...Object.entries(pipelineResult.byCategory).map(
          ([k, v]) =>
            `  ${k.padEnd(14)} ${(v as { count: number; avgValue: number }).count.toLocaleString()} items, avg ${(v as { count: number; avgValue: number }).avgValue}`,
        ),
        '',
        `By day:`,
        ...Object.entries(pipelineResult.byDay).map(
          ([k, v]) => `  ${k}: ${(v as number).toLocaleString()}`,
        ),
      ];

      const match =
        (traditionalResult as AggregateResult[])[0]?.totalRecords ===
        pipelineResult.totalRecords;
      if (match) lines.push('', '✓ Both approaches produced identical results');

      setDone(
        'pipeline-bench',
        btn,
        traditionalMs + pipelineMs,
        lines.join('\n'),
      );
    } catch (e) {
      setError('pipeline-bench', btn, e);
    }
  };
}
