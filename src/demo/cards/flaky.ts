import {
  setRunning,
  setStatus,
  setDone,
  setError,
  Foreman,
} from '../ui-helpers';
import type { FlakyTaskResult } from '../../examples/flaky-task.worker.ts';

export function initFlakyCard(foreman: Foreman) {
  document.getElementById('btn-flaky')!.onclick = async () => {
    const btn = document.getElementById('btn-flaky') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('flaky', btn);
    try {
      const { data: tasks } = await foreman.runWorker('generateFlakyTasks', {
        srcData: { count: 8 },
      });
      setStatus(
        'flaky',
        'running',
        `running ${tasks.length} flaky tasks (retries: 3)…`,
      );

      const {
        data: succeeded,
        failed,
        errors,
      } = await foreman.runWorker('flakyTask', { srcData: tasks });

      const lines = [
        `${(succeeded as FlakyTaskResult[]).length} / ${(succeeded as FlakyTaskResult[]).length + failed} tasks succeeded  (${failed} exhausted retries)`,
        '',
        ...(succeeded as FlakyTaskResult[]).map(
          (d) => `✓ ${d.taskId}  ${d.result}`,
        ),
        ...errors.map((r) => {
          const reason = r.reason as
            | {
                workerConfigs?: {
                  data?: { data?: { taskId?: string } };
                };
              }
            | undefined;
          return `✗ ${reason?.workerConfigs?.data?.data?.taskId ?? 'unknown'}  failed after all retries`;
        }),
      ];
      setDone('flaky', btn, performance.now() - begin, lines.join('\n'));
    } catch (e) {
      setError('flaky', btn, e);
    }
  };
}
