/**
 * Bundled worker (createWorker + defineWorker): statistics of the rows it
 * receives — enough to check which rows each worker got.
 */
import { defineWorker } from '@offmain/workerkit/define-worker';

export interface StatsRow {
  id: number;
  value: number;
}

export function rowStats({ data }: { data: StatsRow[] }) {
  return {
    count: data.length,
    sum: data.reduce((acc, row) => acc + row.value, 0),
    first: data.length ? data[0].id : -1,
    last: data.length ? data[data.length - 1].id : -1,
  };
}

defineWorker(rowStats);
