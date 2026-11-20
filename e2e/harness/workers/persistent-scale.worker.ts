/**
 * Bundled worker (createWorker + defineWorker) used with `runPersistent`.
 * Scales the cached dataset by `config.mult`, optionally after a delay so
 * overlapping calls can be ordered deterministically.
 */
import { defineWorker } from '@offmain/workerkit/define-worker';

export interface ScaleParams {
  data: number[];
  config: { mult: number; delay?: number };
}

export function scale({ data, config }: ScaleParams): Promise<number[]> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve(data.map((n) => n * config.mult)),
      config.delay ?? 0,
    ),
  );
}

defineWorker(scale);
