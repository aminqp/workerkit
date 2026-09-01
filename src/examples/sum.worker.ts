/**
 * Simple sum worker example using `defineWorker`.
 */
import { defineWorker } from '../tools/define-worker/index.ts';

export interface SumPayload {
  a: number;
  b: number;
}

export default defineWorker<SumPayload, number>(({ a, b }) => {
  return a + b;
});
