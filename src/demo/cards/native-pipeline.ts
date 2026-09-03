import {
  setRunning,
  setStatus,
  setDone,
  setError,
  Foreman,
} from '../ui-helpers';
import type { NativePipelineSummary } from '../../examples/native-step3.worker.ts';

export function initNativePipelineCard(foreman: Foreman) {
  const btn = document.getElementById(
    'btn-native-pipeline',
  ) as HTMLButtonElement | null;
  if (!btn) return;

  btn.onclick = async () => {
    const begin = performance.now();
    setRunning('native-pipeline', btn);
    try {
      setStatus(
        'native-pipeline',
        'running',
        'nativeStep1 → nativeStep2 → nativeStep3 (defineWorker pipeline)…',
      );

      const { data: result } = await foreman.pipeline<NativePipelineSummary>([
        { worker: 'nativeStep1', srcData: { count: 30 } },
        { worker: 'nativeStep2', multiplier: 2.0 },
        { worker: 'nativeStep3', minScore: 80 },
      ]);

      const lines = [
        `Native Pipeline execution complete! (defined via defineWorker helper)`,
        `Data flows seamlessly across native worker pipeline steps`,
        '',
        `Summary:`,
        `  Total Processed: ${result.totalProcessed}`,
        `  Passed Threshold (minScore=80): ${result.passedCount}`,
        `  Average Scaled Score: ${result.averageScore}`,
        '',
        `Top items (${Math.min(5, result.topItems.length)} of ${result.topItems.length}):`,
        ...result.topItems
          .slice(0, 5)
          .map(
            (it) =>
              `  [${it.id}] Raw: ${it.rawScore} -> Scaled: ${it.scaledScore} (Grade: ${it.grade})`,
          ),
      ];

      setDone(
        'native-pipeline',
        btn,
        performance.now() - begin,
        lines.join('\n'),
      );
    } catch (e) {
      setError('native-pipeline', btn, e);
    }
  };
}
