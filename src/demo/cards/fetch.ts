import { setRunning, setDone, setError, Foreman } from '../ui-helpers';
import type { EnrichedPost } from '../../examples/fetch-posts.worker.ts';

export function initFetchCard(foreman: Foreman) {
  document.getElementById('btn-fetch')!.onclick = async () => {
    const btn = document.getElementById('btn-fetch') as HTMLButtonElement;
    const begin = performance.now();
    setRunning('fetch', btn);
    try {
      const { data } = await foreman.runWorker('fetchAndEnrichPosts', {
        srcData: { limit: 20 },
      });
      const posts = data as EnrichedPost[];
      const lines = [
        `${posts.length} posts fetched and enriched`,
        '',
        ...posts
          .slice(0, 5)
          .map((p) => `[${p.id}] ${p.titleCase}\n     words: ${p.wordCount}`),
        posts.length > 5 ? `… (${posts.length - 5} more)` : '',
      ].filter((l) => l !== '');
      setDone('fetch', btn, performance.now() - begin, lines.join('\n'));
    } catch (e) {
      setError('fetch', btn, e);
    }
  };
}
