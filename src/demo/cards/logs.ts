import {
  setRunning,
  setStatus,
  setDone,
  setError,
  Foreman,
} from '../ui-helpers';
import type { LogReport } from '../../examples/log-analyzer.worker.ts';

export function initLogsCard(foreman: Foreman) {
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
}
