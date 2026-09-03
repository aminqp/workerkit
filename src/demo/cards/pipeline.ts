import {
  setRunning,
  setStatus,
  setDone,
  setError,
  Foreman,
} from '../ui-helpers';
import type { FilteredPost } from '../../examples/pipeline-demo.worker.ts';

export function initPipelineCard(foreman: Foreman) {
  document.getElementById('btn-pipeline')!.onclick = async () => {
    const btn = document.getElementById('btn-pipeline') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('pipeline', btn);
    try {
      setStatus(
        'pipeline',
        'running',
        'fetch → transform → filter (worker-to-worker)…',
      );

      const { data: result } = await foreman.pipeline<FilteredPost[]>([
        { worker: 'fetchPosts', srcData: { limit: 200 } },
        { worker: 'transformPosts' },
        { worker: 'filterPosts', options: { minWords: 8 } },
      ]);

      const lines = [
        `${result.length} posts after pipeline (fetch → transform → filter)`,
        `Data never touched main thread until now`,
        '',
        ...result
          .slice(0, 8)
          .map(
            (p: FilteredPost) =>
              `[${p.id}] ${p.titleUpperCase.slice(0, 50)}…\n     words: ${p.wordCount}  long: ${p.isLong ? 'yes' : 'no'}`,
          ),
        result.length > 8 ? `\n… (${result.length - 8} more)` : '',
      ].filter((l) => l !== '');

      setDone('pipeline', btn, performance.now() - begin, lines.join('\n'));
    } catch (e) {
      setError('pipeline', btn, e);
    }
  };
}
