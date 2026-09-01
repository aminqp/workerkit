/**
 * Native Worker Step 3: Summarizer & Filter
 * Uses `defineWorker` to process transformed items from Step 2 and generate a summary report.
 */
import { defineWorker } from '../tools/define-worker/index.ts';
import type { TransformedItem } from './native-step2.worker.ts';

export interface NativePipelineSummary {
  totalProcessed: number;
  passedCount: number;
  averageScore: number;
  topItems: TransformedItem[];
}

export interface Step3Params {
  data?: TransformedItem[];
  minScore?: number;
}

export default defineWorker<Step3Params, NativePipelineSummary>((payload) => {
  const items = payload?.data ?? [];
  const minScore = payload?.minScore ?? 100;

  const filtered = (Array.isArray(items) ? items : []).filter(
    (item) => item.scaledScore >= minScore,
  );

  const sum = filtered.reduce((acc, item) => acc + item.scaledScore, 0);
  const avg = filtered.length ? Math.round(sum / filtered.length) : 0;

  return {
    totalProcessed: items.length,
    passedCount: filtered.length,
    averageScore: avg,
    topItems: filtered,
  };
});
