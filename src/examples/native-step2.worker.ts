/**
 * Native Worker Step 2: Data Transformer
 * Uses `defineWorker` to receive items from Step 1 via MessageChannel pipeline or main-thread relay.
 */
import { defineWorker } from '../tools/define-worker.ts';
import type { RawItem } from './native-step1.worker.ts';

export interface TransformedItem extends RawItem {
  scaledScore: number;
  grade: string;
}

export interface Step2Params {
  data?: RawItem[];
  multiplier?: number;
}

export default defineWorker<Step2Params, TransformedItem[]>((payload) => {
  const items = payload?.data ?? [];
  const multiplier = payload?.multiplier ?? 1.5;

  return (Array.isArray(items) ? items : []).map((item) => {
    const scaled = Math.round(item.rawScore * multiplier);
    return {
      ...item,
      scaledScore: scaled,
      grade: scaled >= 200 ? 'A+' : scaled >= 100 ? 'B' : 'C',
    };
  });
});
