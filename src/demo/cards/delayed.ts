import {
  setRunning,
  setStatus,
  setDone,
  setError,
  Foreman,
} from '../ui-helpers';
import type { DelayedTaskResult } from '../../examples/delayed-task.worker.ts';

export function initDelayedCard(foreman: Foreman) {
  document.getElementById('btn-delayed')!.onclick = async () => {
    const btn = document.getElementById('btn-delayed') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('delayed', btn);
    try {
      const genRes = await foreman.runWorker('generateDelayedTasks', {
        srcData: { count: 6, minMs: 2000, maxMs: 5000 },
      });
      const { data: tasks } = await foreman.collectResults(genRes);
      setStatus(
        'delayed',
        'running',
        `running ${tasks.length} tasks concurrently…`,
      );

      const taskRes = await foreman.runWorker('runDelayedTask', {
        srcData: tasks,
      });
      const {
        data: results,
        succeeded,
        failed,
      } = await foreman.collectResults(taskRes);

      const summary = [
        `${succeeded} / ${succeeded + failed} tasks completed`,
        '',
        ...(results as DelayedTaskResult[]).map(
          (r) =>
            `${r.taskId}  ${r.elapsedMs} ms  [${(r.payload as { category: string; priority: string }).category} / ${(r.payload as { category: string; priority: string }).priority}]`,
        ),
      ].join('\n');
      setDone('delayed', btn, performance.now() - begin, summary);
    } catch (e) {
      setError('delayed', btn, e);
    }
  };
}
