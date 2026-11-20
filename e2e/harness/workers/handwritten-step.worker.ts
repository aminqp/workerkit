/**
 * A hand-written pipeline step — no `defineWorker`, just `onmessage` and
 * `postMessage`, the way a team might wrap an existing worker script. It adds
 * 1 to every number and replies in the shape named by the `reply` step
 * parameter:
 *
 *   'ok'      → `{ ok: true, data }`  (the shape `defineWorker` uses)
 *   'wrapped' → `{ data }`            (no `ok` field)
 *   'raw'     → the bare array
 *
 * As a later step of a pipeline it receives its input on the `inputPort`
 * handed over in the `__pipeline_ports__` wiring message.
 */
type Reply = 'ok' | 'wrapped' | 'raw';

interface StepParams {
  reply?: Reply;
}

let stepParams: StepParams = {};

function handle(payload: { data: number[] } & StepParams) {
  const output = payload.data.map((n) => n + 1);
  const reply = payload.reply ?? stepParams.reply ?? 'ok';
  if (reply === 'raw') self.postMessage(output);
  else if (reply === 'wrapped') self.postMessage({ data: output });
  else self.postMessage({ ok: true, data: output });
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message && message.__pipeline_ports__) {
    stepParams = message.stepParams ?? {};
    const inputPort: MessagePort | undefined = message.inputPort;
    if (inputPort) {
      inputPort.onmessage = (input: MessageEvent) =>
        handle({ ...stepParams, data: input.data.data });
    }
    return;
  }
  handle(message);
};
