import { useEffect, useState } from 'react';
import { workerFactory } from '../workers/factory';

/**
 * How many results are stored in the MemoryWorker right now, checked every
 * `intervalMs`. Should drop back to 0 after each run: every step frees what
 * it read with `deleteMemory`.
 */
export function useMemoryHandles(intervalMs = 1000): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const check = () =>
      workerFactory.getMemoryStats().then(
        (stats) => active && setCount(stats.count),
        () => {}, // the factory was terminated (hot reload)
      );
    void check();
    const timer = setInterval(check, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return count;
}
