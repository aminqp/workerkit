/**
 * Bundled worker that echoes back the parameters it received. Used to prove
 * that ordinary `runWorker` calls are never mistaken for persistent-protocol
 * messages, even when the caller passes a parameter called `type`.
 */
import { defineWorker } from '@offmain/workerkit/define-worker';

export interface EchoParams {
  data: unknown;
  type?: unknown;
  config?: unknown;
}

export function echo({ data, type, config }: EchoParams) {
  return { data, type, config };
}

defineWorker(echo);
