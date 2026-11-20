import { useEffect, useState } from 'react';
import type { ChunkSpec, Summary, TransactionRow } from '../types';
import { workerFactory } from '../workers/factory';

/** Rows per generator job; the jobs are split across the worker threads. */
const CHUNK_SIZE = 1_000;

export interface Timings {
  generate: number;
  transform: number;
  summarize: number;
}

export interface TransactionsState {
  status: 'running' | 'done' | 'error';
  rows: TransactionRow[];
  summary: Summary | null;
  timings: Timings | null;
  error: string | null;
  /** The `runId` of the last run that finished. */
  completedRun: number | null;
}

const INITIAL: TransactionsState = {
  status: 'running',
  rows: [],
  summary: null,
  timings: null,
  error: null,
  completedRun: null,
};

/**
 * Generates `rowCount` transactions, transforms them and summarizes them —
 * all in Web Workers. Changing `runId` starts a new run.
 *
 * A run that is superseded (the component unmounts, `runId` changes, or
 * StrictMode re-runs the effect on mount) stops between steps and frees what
 * it stored in the MemoryWorker, instead of overwriting newer results.
 */
export function useTransactions(
  rowCount: number,
  runId: number,
): TransactionsState {
  const [state, setState] = useState<TransactionsState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, status: 'running', error: null }));

    async function run() {
      const chunks: ChunkSpec[] = [];
      for (let start = 0; start < rowCount; start += CHUNK_SIZE) {
        chunks.push({ start, count: Math.min(CHUNK_SIZE, rowCount - start) });
      }

      // 1. Generate. `memoryOnly`: the result has no `data`, just a ref.
      let started = performance.now();
      const generated = await workerFactory.runWorker('generate', {
        srcData: chunks,
      });
      const generate = performance.now() - started;
      const rawRef = generated.__memory_ref__;
      if (!rawRef) {
        throw new Error(`Generating failed in ${generated.failed} worker(s)`);
      }
      if (cancelled) {
        await workerFactory.deleteMemory(rawRef);
        return;
      }

      // 2. Transform, partitioned across threads, starting from the ref: each
      //    worker reads its part straight from the MemoryWorker.
      //    `deleteMemory` frees the raw rows once they have been read.
      started = performance.now();
      const transformed = await workerFactory.runWorker('transform', {
        __memory_ref__: rawRef,
        deleteMemory: true,
      });
      const transform = performance.now() - started;
      const rowsRef = transformed.__memory_ref__;
      if (cancelled || !rowsRef || transformed.failed > 0) {
        if (rowsRef) await workerFactory.deleteMemory(rowsRef);
        if (cancelled) return;
        throw new Error(
          `Transforming failed in ${transformed.failed} worker(s)`,
        );
      }

      // 3. Summarize the stored rows by ref, then free them.
      started = performance.now();
      const summarized = await workerFactory.runWorker('summarize', {
        __memory_ref__: rowsRef,
        deleteMemory: true,
        reducer: (shards) => shards[0],
      });
      const summarize = performance.now() - started;
      if (cancelled) return;

      setState({
        status: 'done',
        rows: transformed.data,
        summary: summarized.data,
        timings: { generate, transform, summarize },
        error: null,
        completedRun: runId,
      });
    }

    run().catch((error: unknown) => {
      // A superseded run may fail because its factory was terminated (e.g.
      // by a hot reload) — nothing to report then.
      if (cancelled) return;
      setState((previous) => ({
        ...previous,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [rowCount, runId]);

  return state;
}
