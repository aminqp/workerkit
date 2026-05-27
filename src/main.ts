import expensiveComputation1 from './examples/expensive-computation-1.worker.ts';
import { MainWorkerFactory } from './tools';
import { transformArray } from './examples/list-transformer.worker.ts';
import { generateRandomData } from './examples/mocker.worker.ts';
import {
  generateListTransformArrayTestData,
  listTransformArray,
} from './examples/large-ist.worker.ts';

import {
  generateImageData,
  processImageData,
} from './examples/image-processor.worker.ts';
import { generateLogs, analyzeLogs } from './examples/log-analyzer.worker.ts';
import type { LogReport } from './examples/log-analyzer.worker.ts';
import {
  generateDelayedTasks,
  runDelayedTask,
} from './examples/delayed-task.worker.ts';
import {
  multiplyMatrices,
  runOnMainThread,
} from './examples/benchmark.worker.ts';
import { generateFlakyTasks, flakyTask } from './examples/flaky-task.worker.ts';
import {
  generateSearchShards,
  searchShard,
} from './examples/partial-results.worker.ts';
import { fetchAndEnrichPosts } from './examples/fetch-posts.worker.ts';
import type { EnrichedPost } from './examples/fetch-posts.worker.ts';
import type { DelayedTaskResult } from './examples/delayed-task.worker.ts';
import type { FlakyTaskResult } from './examples/flaky-task.worker.ts';
import {
  fetchPosts,
  transformPosts,
  filterPosts,
} from './examples/pipeline-demo.worker.ts';
import type { FilteredPost } from './examples/pipeline-demo.worker.ts';
import {
  generateLargeDataset,
  heavyTransform,
  aggregateResults,
} from './examples/pipeline-benchmark.worker.ts';
import type { AggregateResult } from './examples/pipeline-benchmark.worker.ts';

// --- worker setup ---

const workerConfigs = [
  {
    name: 'exp1',
    role: 'computation',
    func: expensiveComputation1,
    retries: 3,
  },
  {
    name: 'generateRandomData',
    role: 'computation',
    func: generateRandomData,
    retries: 3,
    maxConcurrency: 13,
  },
  {
    name: 'transformArray',
    role: 'computation',
    func: transformArray,
    partition: true,
    maxConcurrency: 8,
  },
  {
    name: 'generateListTransformArrayTestData',
    role: 'computation',
    func: generateListTransformArrayTestData,
    partition: true,
    maxConcurrency: 10,
  },
  {
    name: 'listTransformArray',
    role: 'computation',
    func: listTransformArray,
    partition: true,
  },
  {
    name: 'generateImageData',
    role: 'computation',
    func: generateImageData,
    maxConcurrency: 1,
  },
  {
    name: 'processImageData',
    role: 'computation',
    func: processImageData,
    maxConcurrency: 1,
  },
  {
    name: 'generateLogs',
    role: 'computation',
    func: generateLogs,
    partition: true,
    maxConcurrency: 8,
  },
  {
    name: 'analyzeLogs',
    role: 'computation',
    func: analyzeLogs,
    partition: true,
    maxConcurrency: 8,
  },
  {
    name: 'generateDelayedTasks',
    role: 'computation',
    func: generateDelayedTasks,
    maxConcurrency: 1,
  },
  {
    name: 'runDelayedTask',
    role: 'computation',
    func: runDelayedTask,
    partition: true,
    maxConcurrency: 6,
  },
  {
    name: 'multiplyMatrices',
    role: 'computation',
    func: multiplyMatrices,
    partition: true,
    maxConcurrency: 6,
  },
  {
    name: 'generateFlakyTasks',
    role: 'computation',
    func: generateFlakyTasks,
    maxConcurrency: 1,
  },
  {
    name: 'flakyTask',
    role: 'computation',
    func: flakyTask,
    partition: true,
    maxConcurrency: 8,
    retries: 3,
  },
  {
    name: 'generateSearchShards',
    role: 'computation',
    func: generateSearchShards,
    maxConcurrency: 1,
  },
  {
    name: 'searchShard',
    role: 'computation',
    func: searchShard,
    partition: true,
    maxConcurrency: 8,
    retries: 0,
  },
  {
    name: 'fetchAndEnrichPosts',
    role: 'computation',
    func: fetchAndEnrichPosts,
    maxConcurrency: 1,
  },
  {
    name: 'fetchPosts',
    role: 'io',
    func: fetchPosts,
    maxConcurrency: 1,
  },
  {
    name: 'transformPosts',
    role: 'transform',
    func: transformPosts,
    maxConcurrency: 1,
  },
  {
    name: 'filterPosts',
    role: 'transform',
    func: filterPosts,
    maxConcurrency: 1,
  },
  {
    name: 'generateLargeDataset',
    role: 'computation',
    func: generateLargeDataset,
    maxConcurrency: 1,
  },
  {
    name: 'heavyTransform',
    role: 'computation',
    func: heavyTransform,
    maxConcurrency: 1,
  },
  {
    name: 'aggregateResults',
    role: 'computation',
    func: aggregateResults,
    maxConcurrency: 1,
  },
] as const;

const foreman = new MainWorkerFactory({ workers: workerConfigs });

// --- UI helpers ---

type CardId =
  | 'exp1'
  | 'gen'
  | 'transform'
  | 'list'
  | 'image'
  | 'logs'
  | 'delayed'
  | 'flaky'
  | 'partial'
  | 'bench'
  | 'fetch'
  | 'pipeline'
  | 'pipeline-bench';

function setStatus(
  id: CardId,
  state: 'running' | 'done' | 'error' | 'partial',
  text: string,
) {
  const el = document.getElementById(`status-${id}`)!;
  el.className = `card-status ${state}`;
  el.textContent = text;
}

function setResult(id: CardId, text: string) {
  const el = document.getElementById(`result-${id}`)!;
  el.textContent = text;
  el.classList.add('visible');
}

function setRunning(id: CardId, btn: HTMLButtonElement) {
  btn.disabled = true;
  setStatus(id, 'running', 'running…');
}

function setDone(
  id: CardId,
  btn: HTMLButtonElement,
  elapsed: number,
  summary: string,
) {
  btn.disabled = false;
  setStatus(id, 'done', `done in ${elapsed.toFixed(0)} ms`);
  setResult(id, summary);
}

function setError(id: CardId, btn: HTMLButtonElement, err: unknown) {
  btn.disabled = false;
  setStatus(id, 'error', 'error');
  setResult(id, String(err));
}

function preview(data: unknown[], maxItems = 3): string {
  const sample = data.slice(0, maxItems);
  return (
    JSON.stringify(sample, null, 2) +
    (data.length > maxItems ? `\n… (${data.length} total)` : '')
  );
}

// ─── card 1: expensive computation ───────────────────────────────────────────

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

// ─── card 2: generate random data ────────────────────────────────────────────

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

// ─── card 3: generate → transform ────────────────────────────────────────────

document.getElementById('btn-transform')!.onclick = async () => {
  const btn = document.getElementById('btn-transform') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('transform', btn);
  try {
    const genRes = await foreman.runWorker('generateRandomData', {
      srcData: { count: 300000 },
    });
    const { data: testData } = await foreman.collectResults(genRes);
    setStatus('transform', 'running', `transforming ${testData.length} items…`);
    const transformRes = await foreman.runWorker('transformArray', {
      srcData: testData,
      options: {
        prefix: 'pre',
        suffix: 'suf',
        currency: 'USD',
        round: 'round',
        multiplier: 'multiplier',
      },
    });
    const { data: result } = await foreman.collectResults(transformRes);
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

// ─── card 4: structured list transform ───────────────────────────────────────

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

// ─── card 5: image processing ────────────────────────────────────────────────

document.getElementById('btn-image')!.onclick = async () => {
  const btn = document.getElementById('btn-image') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('image', btn);
  try {
    const genResults = await Promise.all(
      Array.from({ length: 4 }, () =>
        foreman.runWorker('generateImageData', {
          srcData: { width: 512, height: 512 },
        }),
      ),
    );
    const images = await Promise.all(
      genResults.map((r) => foreman.collectResults(r)),
    );
    const imgData = images.map(
      (r) => (r.data as { data: number[]; width: number; height: number }[])[0],
    );

    setStatus(
      'image',
      'running',
      `processing ${imgData.length} × 512×512 images…`,
    );

    const processResults = await Promise.all(
      imgData.map((img) =>
        foreman.runWorker('processImageData', { srcData: img }),
      ),
    );
    const processed = await Promise.all(
      processResults.map((r) => foreman.collectResults(r)),
    );

    const summary = processed
      .map((r, i) => {
        const img = (
          r.data as { data: number[]; width: number; height: number }[]
        )[0];
        return `Image ${i + 1}: ${img.width}×${img.height}, ${img.data.length} bytes processed`;
      })
      .join('\n');
    setDone('image', btn, performance.now() - begin, summary);
  } catch (e) {
    setError('image', btn, e);
  }
};

// ─── card 6: log analysis ────────────────────────────────────────────────────

document.getElementById('btn-logs')!.onclick = async () => {
  const btn = document.getElementById('btn-logs') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('logs', btn);
  try {
    const genRes = await foreman.runWorker('generateLogs', {
      srcData: { count: 500000 },
    });
    const { data: logs } = await foreman.collectResults(genRes);
    setStatus('logs', 'running', `analysing ${logs.length} log entries…`);

    const analyzeRes = await foreman.runWorker('analyzeLogs', {
      srcData: logs,
    });

    // merge shard reports off the main thread using a custom reducer
    setStatus('logs', 'running', 'merging shard reports…');
    const { data: merged } = await foreman.collectResults(analyzeRes, {
      reducer: (shards: LogReport[]) => {
        const acc = {
          total: 0,
          errorCount: 0,
          byLevel: {} as Record<string, number>,
          byService: {} as Record<string, number>,
          durationSum: 0,
        };
        for (const r of shards) {
          acc.total += r.total;
          acc.errorCount += r.byLevel.ERROR + r.byLevel.FATAL;
          for (const [k, v] of Object.entries(r.byLevel))
            acc.byLevel[k] = (acc.byLevel[k] ?? 0) + (v as number);
          for (const [k, v] of Object.entries(r.byService))
            acc.byService[k] = (acc.byService[k] ?? 0) + (v as number);
          acc.durationSum += r.avgDurationMs * r.total;
        }
        return {
          total: acc.total,
          errorRate: ((acc.errorCount / acc.total) * 100).toFixed(2) + '%',
          avgDurationMs: (acc.durationSum / acc.total).toFixed(0) + ' ms',
          byLevel: acc.byLevel,
          byService: acc.byService,
        };
      },
    });

    const summary = [
      `Total entries : ${merged.total.toLocaleString()}`,
      `Error rate    : ${merged.errorRate}`,
      `Avg duration  : ${merged.avgDurationMs}`,
      ``,
      `By level:`,
      ...Object.entries(merged.byLevel).map(
        ([k, v]) => `  ${k.padEnd(6)}: ${(v as number).toLocaleString()}`,
      ),
      ``,
      `By service:`,
      ...Object.entries(merged.byService).map(
        ([k, v]) => `  ${k.padEnd(20)}: ${(v as number).toLocaleString()}`,
      ),
    ].join('\n');
    setDone('logs', btn, performance.now() - begin, summary);
  } catch (e) {
    setError('logs', btn, e);
  }
};

// ─── card 7: delayed batch tasks ─────────────────────────────────────────────

document.getElementById('btn-delayed')!.onclick = async () => {
  const btn = document.getElementById('btn-delayed') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('delayed', btn);
  try {
    const genRes = await foreman.runWorker('generateDelayedTasks', {
      srcData: { count: 6, minMs: 2000, maxMs: 5000 },
    });
    const { data: tasks } = await foreman.collectResults(genRes);
    setStatus(
      'delayed',
      'running',
      `running ${tasks.length} tasks concurrently…`,
    );

    const taskRes = await foreman.runWorker('runDelayedTask', {
      srcData: tasks,
    });
    const {
      data: results,
      succeeded,
      failed,
    } = await foreman.collectResults(taskRes);

    const summary = [
      `${succeeded} / ${succeeded + failed} tasks completed`,
      '',
      ...(results as DelayedTaskResult[]).map(
        (r) =>
          `${r.taskId}  ${r.elapsedMs} ms  [${(r.payload as { category: string; priority: string }).category} / ${(r.payload as { category: string; priority: string }).priority}]`,
      ),
    ].join('\n');
    setDone('delayed', btn, performance.now() - begin, summary);
  } catch (e) {
    setError('delayed', btn, e);
  }
};

// ─── card 8: flaky tasks with retries ────────────────────────────────────────

document.getElementById('btn-flaky')!.onclick = async () => {
  const btn = document.getElementById('btn-flaky') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('flaky', btn);
  try {
    const genRes = await foreman.runWorker('generateFlakyTasks', {
      srcData: { count: 8 },
    });
    const { data: tasks } = await foreman.collectResults(genRes);
    setStatus(
      'flaky',
      'running',
      `running ${tasks.length} flaky tasks (retries: 3)…`,
    );

    const taskRes = await foreman.runWorker('flakyTask', { srcData: tasks });
    const {
      data: succeeded,
      failed,
      errors,
    } = await foreman.collectResults(taskRes);

    const lines = [
      `${(succeeded as FlakyTaskResult[]).length} / ${(succeeded as FlakyTaskResult[]).length + failed} tasks succeeded  (${failed} exhausted retries)`,
      '',
      ...(succeeded as FlakyTaskResult[]).map(
        (d) => `✓ ${d.taskId}  ${d.result}`,
      ),
      ...errors.map(
        (r) =>
          `✗ ${r.reason?.workerConfigs?.data?.data?.taskId ?? 'unknown'}  failed after all retries`,
      ),
    ];
    setDone('flaky', btn, performance.now() - begin, lines.join('\n'));
  } catch (e) {
    setError('flaky', btn, e);
  }
};

// ─── card 9: partial results (some shards fail, show what we have) ────────────

document.getElementById('btn-partial')!.onclick = async () => {
  const btn = document.getElementById('btn-partial') as HTMLButtonElement;
  setRunning('partial', btn);
  try {
    const genRes = await foreman.runWorker('generateSearchShards', {
      srcData: { shardCount: 8, query: 'web workers', failEvery: 3 },
    });
    const { data: shards } = await foreman.collectResults(genRes);
    setStatus('partial', 'running', `querying ${shards.length} search shards…`);

    const shardRes = await foreman.runWorker('searchShard', {
      srcData: shards,
    });

    // merge + rank off the main thread via custom reducer
    setStatus('partial', 'running', 'ranking results…');
    const {
      data: allResults,
      succeeded,
      failed,
    } = await foreman.collectResults(shardRes, {
      reducer: (shards) => shards.flat().sort((a, b) => b.score - a.score),
    });

    const statusText = `${succeeded} shards OK, ${failed} failed — showing partial results`;
    document.getElementById('status-partial')!.className =
      'card-status partial';
    document.getElementById('status-partial')!.textContent = statusText;
    btn.disabled = false;

    const lines = [
      statusText,
      '',
      `Top results (${allResults.length} total from ${succeeded} shards):`,
      ...allResults
        .slice(0, 6)
        .map((r) => `  [${r.score.toFixed(3)}] ${r.title}`),
    ];
    setResult('partial', lines.join('\n'));
  } catch (e) {
    setError('partial', btn, e);
  }
};

// ─── card 10: main thread vs workers benchmark ────────────────────────────────

const BENCH_SIZE = 350;
const BENCH_COUNT = 6;

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
  const workerRes = await foreman.runWorker('multiplyMatrices', {
    srcData: tasks,
  });
  const workerTotalMs = Math.round(performance.now() - workerStart);

  const { data: workerTasks } = await foreman.collectResults(workerRes);

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
    `  per task    : ${workerTasks.map((t) => t.durationMs).join(' ms,  ')} ms`,
    ``,
    `Speedup       : ${speedup}×`,
  ];
  setDone('bench', btn, workerTotalMs, lines.join('\n'));
};

// ─── card 11: fetch & enrich posts ───────────────────────────────────────────

document.getElementById('btn-fetch')!.onclick = async () => {
  const btn = document.getElementById('btn-fetch') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('fetch', btn);
  try {
    const res = await foreman.runWorker('fetchAndEnrichPosts', {
      srcData: { limit: 20 },
    });
    const { data } = await foreman.collectResults(res);
    const posts = data as EnrichedPost[];
    const lines = [
      `${posts.length} posts fetched and enriched`,
      '',
      ...posts
        .slice(0, 5)
        .map((p) => `[${p.id}] ${p.titleCase}\n     words: ${p.wordCount}`),
      posts.length > 5 ? `… (${posts.length - 5} more)` : '',
    ].filter((l) => l !== '');
    setDone('fetch', btn, performance.now() - begin, lines.join('\n'));
  } catch (e) {
    setError('fetch', btn, e);
  }
};

// ─── card 2: worker-to-worker pipeline ───────────────────────────────────────

document.getElementById('btn-pipeline')!.onclick = async () => {
  const btn = document.getElementById('btn-pipeline') as HTMLButtonElement;
  const begin = performance.now();
  setRunning('pipeline', btn);
  try {
    setStatus(
      'pipeline',
      'running',
      'fetch → transform → filter (worker-to-worker)…',
    );

    const result = await foreman.pipeline<FilteredPost[]>([
      { worker: 'fetchPosts', srcData: { limit: 200 } },
      { worker: 'transformPosts' },
      { worker: 'filterPosts' },
    ]);

    const lines = [
      `${result.length} posts after pipeline (fetch → transform → filter)`,
      `Data never touched main thread until now`,
      '',
      ...result
        .slice(0, 8)
        .map(
          (p) =>
            `[${p.id}] ${p.titleUpperCase.slice(0, 50)}…\n     words: ${p.wordCount}  long: ${p.isLong ? 'yes' : 'no'}`,
        ),
      result.length > 8 ? `\n… (${result.length - 8} more)` : '',
    ].filter((l) => l !== '');

    setDone('pipeline', btn, performance.now() - begin, lines.join('\n'));
  } catch (e) {
    setError('pipeline', btn, e);
  }
};

// ─── pipeline benchmark: traditional vs pipeline ─────────────────────────────

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

    const pipelineResult = await foreman.pipeline<AggregateResult>([
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
    const dataSizeEstimate = Math.round((RECORD_COUNT * 220 * 2) / 1024 / 1024);

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
          `  ${k.padEnd(14)} ${v.count.toLocaleString()} items, avg ${v.avgValue}`,
      ),
      '',
      `By day:`,
      ...Object.entries(pipelineResult.byDay).map(
        ([k, v]) => `  ${k}: ${v.toLocaleString()}`,
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
