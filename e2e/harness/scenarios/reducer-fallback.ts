/**
 * Regression check — console output when the reducer cannot run in a worker.
 *
 * A reducer that uses a variable from outside the function fails inside the
 * reducer worker (the variable does not exist there) and is re-run on the
 * main thread, where it works. v1.0.0 logged exactly one error for that at
 * the default log level; it must not log more now.
 */
import {
  MainWorkerFactory,
  defineWorkerConfig,
  defineWorkerConfigs,
} from '@offmain/workerkit';
import { settle, summarize } from '../helpers';

const OFFSET = 100;

interface LogEntry {
  level: 'error' | 'info';
  message: string;
}

/** Runs a closure reducer and returns the result plus the library's console output. */
export async function closureReducer(logLevel?: 'error' | 'info') {
  const logged: LogEntry[] = [];
  const original = { error: console.error, info: console.info };
  const capture =
    (level: LogEntry['level']) =>
    (...args: unknown[]) => {
      logged.push({ level, message: args.map(String).join(' ') });
    };
  console.error = capture('error');
  console.info = capture('info');

  try {
    const factory = new MainWorkerFactory({
      workers: defineWorkerConfigs(
        defineWorkerConfig({
          name: 'identity',
          role: 'compute',
          func: ({ data }: { data: number[] }) => data,
          partition: true,
          maxConcurrency: 3,
        }),
      ),
      ...(logLevel ? { logLevel } : {}),
    });
    const result = await settle(
      factory
        .runWorker('identity', {
          srcData: [1, 2, 3],
          reducer: (shards: number[][]) => shards.flat().map((n) => n + OFFSET),
        })
        .then(summarize),
    );
    factory.terminate();
    return {
      result,
      logged: logged.filter((entry) =>
        entry.message.startsWith('[WorkerManager]'),
      ),
    };
  } finally {
    console.error = original.error;
    console.info = original.info;
  }
}
