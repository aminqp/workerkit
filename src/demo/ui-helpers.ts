import type MainWorkerFactory from '../tools/main-worker-factory/main-worker-factory';
import type {
  WorkerConfig,
  WorkerFunction,
} from '../tools/main-worker-factory/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfigs = readonly WorkerConfig<WorkerFunction<any, any>>[];
export type Foreman = InstanceType<typeof MainWorkerFactory<AnyConfigs>>;

export type CardId =
  | 'exp1'
  | 'gen'
  | 'transform'
  | 'list'
  | 'image'
  | 'logs'
  | 'delayed'
  | 'flaky'
  | 'partial'
  | 'bench'
  | 'fetch'
  | 'pipeline'
  | 'pipeline-bench'
  | 'persistent'
  | 'persistent-bench'
  | 'bundler';

export function setStatus(
  id: CardId,
  state: 'running' | 'done' | 'error' | 'partial',
  text: string,
) {
  const el = document.getElementById(`status-${id}`)!;
  el.className = `card-status ${state}`;
  el.textContent = text;
}

export function setResult(id: CardId, text: string) {
  const el = document.getElementById(`result-${id}`)!;
  el.textContent = text;
  el.classList.add('visible');
}

export function setRunning(id: CardId, btn: HTMLButtonElement) {
  btn.disabled = true;
  setStatus(id, 'running', 'running…');
}

export function setDone(
  id: CardId,
  btn: HTMLButtonElement,
  elapsed: number,
  summary: string,
) {
  btn.disabled = false;
  setStatus(id, 'done', `done in ${elapsed.toFixed(0)} ms`);
  setResult(id, summary);
}

export function setError(id: CardId, btn: HTMLButtonElement, err: unknown) {
  btn.disabled = false;
  setStatus(id, 'error', 'error');
  setResult(id, String(err));
}

export function preview(data: unknown[], maxItems = 3): string {
  const sample = data.slice(0, maxItems);
  return (
    JSON.stringify(sample, null, 2) +
    (data.length > maxItems ? `\n… (${data.length} total)` : '')
  );
}
