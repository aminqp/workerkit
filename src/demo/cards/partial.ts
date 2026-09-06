import { setRunning, setStatus, setError, setResult } from '../ui-helpers';

interface SearchResult {
  score: number;
  title: string;
}
import { foreman } from '../demo';

export function initPartialCard() {
  document.getElementById('btn-partial')!.onclick = async () => {
    const btn = document.getElementById('btn-partial') as HTMLButtonElement;
    setRunning('partial', btn);
    try {
      const { data: shards } = await foreman.runWorker('generateSearchShards', {
        srcData: { shardCount: 8, query: 'web workers', failEvery: 3 },
      });
      setStatus(
        'partial',
        'running',
        `querying ${shards.length} search shards…`,
      );

      // merge + rank off the main thread via custom reducer
      setStatus('partial', 'running', 'ranking results…');
      const {
        data: allResults,
        succeeded,
        failed,
      } = await foreman.runWorker('searchShard', {
        srcData: shards,
        reducer: (shards: SearchResult[][]) =>
          shards.flat().sort((a, b) => b.score - a.score),
      });

      const statusText = `${succeeded} shards OK, ${failed} failed — showing partial results`;
      document.getElementById('status-partial')!.className =
        'card-status partial';
      document.getElementById('status-partial')!.textContent = statusText;
      btn.disabled = false;

      const lines = [
        statusText,
        '',
        `Top results (${(allResults as SearchResult[]).length} total from ${succeeded} shards):`,
        ...(allResults as SearchResult[])
          .slice(0, 6)
          .map((r) => `  [${r.score.toFixed(3)}] ${r.title}`),
      ];
      setResult('partial', lines.join('\n'));
    } catch (e) {
      setError('partial', btn, e);
    }
  };
}
