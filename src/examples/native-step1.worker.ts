/**
 * Native Worker Step 1: Data Generator
 * Uses `defineWorker` for type-safe message handling, zero-copy transfers, and pipeline wiring.
 */
import { defineWorker } from '../tools/define-worker.ts';

export interface Step1Payload {
  count?: number;
}

export interface RawItem {
  id: number;
  rawScore: number;
}

export default defineWorker<Step1Payload, RawItem[]>((payload) => {
  const count = payload?.count ?? 25;

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    rawScore: (i + 1) * 12,
  }));
});
