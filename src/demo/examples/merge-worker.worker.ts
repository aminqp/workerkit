import type { LogReport } from './log-analyzer.worker';
import type { SearchResult } from './partial-results.worker';

export type MergeStrategy = 'flatArray' | 'logReports' | 'rankedSearch';

export interface MergeInput {
  strategy: MergeStrategy;
  shards: unknown[];
}

export interface MergedLogReport {
  total: number;
  errorRate: string;
  avgDurationMs: string;
  byLevel: Record<string, number>;
  byService: Record<string, number>;
}

/**
 * Runs entirely in a worker — merges shard results using the requested strategy.
 * Keeps all aggregation off the main thread.
 */
export function mergeShards({ data }: { data: MergeInput }): unknown {
  const { strategy, shards } = Array.isArray(data) ? data[0] : data;

  switch (strategy) {
    case 'flatArray': {
      // Flatten array-of-arrays into one array
      return (shards as unknown[][]).flat();
    }

    case 'logReports': {
      // Merge N LogReport objects into one summary
      const reports = shards as LogReport[];
      const acc = {
        total: 0,
        errorCount: 0,
        byLevel: {} as Record<string, number>,
        byService: {} as Record<string, number>,
        durationSum: 0,
      };

      for (const r of reports) {
        acc.total += r.total;
        acc.errorCount += r.byLevel.ERROR + r.byLevel.FATAL;
        for (const [lvl, n] of Object.entries(r.byLevel)) {
          acc.byLevel[lvl] = (acc.byLevel[lvl] ?? 0) + n;
        }
        for (const [svc, n] of Object.entries(r.byService)) {
          acc.byService[svc] = (acc.byService[svc] ?? 0) + n;
        }
        acc.durationSum += r.avgDurationMs * r.total;
      }

      return {
        total: acc.total,
        errorRate: ((acc.errorCount / acc.total) * 100).toFixed(2) + '%',
        avgDurationMs: (acc.durationSum / acc.total).toFixed(0) + ' ms',
        byLevel: acc.byLevel,
        byService: acc.byService,
      } as MergedLogReport;
    }

    case 'rankedSearch': {
      // Merge N SearchResult[] shards, sort by score descending
      const all = (shards as SearchResult[][]).flat();
      all.sort((a, b) => b.score - a.score);
      return all;
    }

    default:
      throw new Error(`Unknown merge strategy: ${strategy}`);
  }
}
