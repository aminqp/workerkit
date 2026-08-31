import {
  setRunning,
  setStatus,
  setDone,
  setError,
  Foreman,
} from '../ui-helpers';

export function initMemoryCard(foreman: Foreman) {
  const btnRun = document.getElementById('btn-memory') as HTMLButtonElement;
  const btnStats = document.getElementById(
    'btn-memory-stats',
  ) as HTMLButtonElement;
  const btnClear = document.getElementById(
    'btn-memory-clear',
  ) as HTMLButtonElement;

  if (btnRun) {
    btnRun.onclick = async () => {
      const begin = performance.now();
      setRunning('memory', btnRun);
      try {
        setStatus(
          'memory',
          'running',
          'generating 250,000 items (memoryOnly: true)…',
        );

        // Step 1: Run producer configured with memoryOnly: true
        const genRes = await foreman.runWorker('generateMemoryData', {
          srcData: { count: 250000 },
        });

        const genCollected = await foreman.collectResults(genRes);
        const memoryPayload = genCollected.data as unknown as {
          __memory_ref__: string;
        };
        const ref = memoryPayload.__memory_ref__;

        setStatus(
          'memory',
          'running',
          `Producer returned __memory_ref__: ${ref} (0 dataset payload to main thread)\nPassing ref to consumer worker with deleteMemory: true…`,
        );

        // Step 2: Run consumer worker passing __memory_ref__ and deleteMemory: true
        const processRes = await foreman.runWorker('processMemoryData', {
          __memory_ref__: ref,
          options: { multiplier: 3 },
        });

        const processCollected = await foreman.collectResults(processRes);
        const result = processCollected.data;

        const statsAfter = await foreman.getMemoryStats();

        setDone(
          'memory',
          btnRun,
          performance.now() - begin,
          `Producer Output: { __memory_ref__: "${ref}" } (0 bytes dataset transferred to main thread)\n` +
            `Consumer Result: ${JSON.stringify(result, null, 2)}\n` +
            `Active Memory Handles Remaining: ${statsAfter.count}`,
        );
      } catch (e) {
        setError('memory', btnRun, e);
      }
    };
  }

  if (btnStats) {
    btnStats.onclick = async () => {
      try {
        const stats = await foreman.getMemoryStats();
        setStatus(
          'memory',
          'idle',
          `Active Memory Handles: ${stats.count}\nRefs: ${JSON.stringify(stats.refs)}`,
        );
      } catch (e) {
        setError('memory', btnStats, e);
      }
    };
  }

  if (btnClear) {
    btnClear.onclick = async () => {
      try {
        await foreman.clearMemory();
        const stats = await foreman.getMemoryStats();
        setStatus(
          'memory',
          'idle',
          `Memory Cleared!\nActive Memory Handles: ${stats.count}`,
        );
      } catch (e) {
        setError('memory', btnClear, e);
      }
    };
  }
}
