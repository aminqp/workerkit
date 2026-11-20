import { partBounds } from '../partition-array';

/**
 * Script source for the dedicated MemoryWorker thread.
 *
 * Runs inside an isolated Web Worker thread and maintains the MemoryStore.
 * Handshakes and authenticates all incoming MessagePort requests using a secret `factoryToken`.
 *
 * Supports direct worker-to-MemoryWorker communication via `REGISTER_PORT`:
 * A `MessagePort` can be registered so that computing workers and reducer workers
 * can read/write data directly without routing through the main thread.
 *
 * Workers that start from a stored result read it here: `GET` for the whole
 * value, `GET_PART` for one partition of a stored array (split exactly like
 * `partitionArray`), and `DESCRIBE` tells the main thread how many items there
 * are to split — without sending the data itself.
 */
export const memoryWorkerScript = `
const store = new Map();
const partBounds = ${partBounds.toString()};

function handleMessage(msg, replyTarget) {
  if (!msg || typeof msg !== 'object') return;

  const { action, factoryToken, expectedToken, ref, data, id, part } = msg;

  // Initial handshake to set expected token if needed
  if (action === 'INIT_TOKEN') {
    self.__expectedToken = expectedToken;
    replyTarget.postMessage({ ok: true, action: 'INIT_TOKEN_ACK' });
    return;
  }

  // Validate factory token
  if (self.__expectedToken && factoryToken !== self.__expectedToken) {
    replyTarget.postMessage({ ok: false, error: 'Unauthorized: invalid factory token', id });
    return;
  }

  try {
    switch (action) {
      case 'SET': {
        const refId = ref || ('mem_' + crypto.randomUUID());
        store.set(refId, data);
        replyTarget.postMessage({ ok: true, ref: refId, id });
        break;
      }
      case 'GET': {
        const resultData = store.get(ref);
        const exists = store.has(ref);
        replyTarget.postMessage({ ok: true, exists, data: resultData, ref, id });
        break;
      }
      case 'GET_PART': {
        // One partition of a stored array — the part a partitioned worker needs.
        const value = store.get(ref);
        if (!store.has(ref) || !Array.isArray(value)) {
          replyTarget.postMessage({ ok: true, exists: store.has(ref), data: undefined, ref, id });
          break;
        }
        const bounds = partBounds(value.length, part.count, part.index);
        replyTarget.postMessage({
          ok: true,
          exists: true,
          data: value.slice(bounds[0], bounds[1]),
          ref,
          id,
        });
        break;
      }
      case 'DESCRIBE': {
        // Shape of a stored value, so the main thread can plan partitions
        // without receiving the data.
        const value = store.get(ref);
        replyTarget.postMessage({
          ok: true,
          exists: store.has(ref),
          isArray: Array.isArray(value),
          length: Array.isArray(value) ? value.length : undefined,
          ref,
          id,
        });
        break;
      }
      case 'DELETE': {
        const deleted = store.delete(ref);
        replyTarget.postMessage({ ok: true, deleted, ref, id });
        break;
      }
      case 'CLEAR': {
        store.clear();
        replyTarget.postMessage({ ok: true, action: 'CLEAR_ACK', id });
        break;
      }
      case 'STATS': {
        replyTarget.postMessage({
          ok: true,
          stats: {
            count: store.size,
            refs: Array.from(store.keys()),
          },
          id,
        });
        break;
      }
      case 'REGISTER_PORT': {
        // Register a MessagePort from a computing or reducer worker.
        // All messages arriving on this port are handled with the same
        // store operations, enabling direct worker-to-MemoryWorker data flow.
        const port = msg.port;
        if (!port) {
          replyTarget.postMessage({ ok: false, error: 'REGISTER_PORT requires a port', id });
          break;
        }
        port.onmessage = (event) => handleMessage(event.data, port);
        port.start();
        replyTarget.postMessage({ ok: true, action: 'PORT_REGISTERED', id });
        break;
      }
      default:
        replyTarget.postMessage({ ok: false, error: 'Unknown action: ' + action, id });
    }
  } catch (err) {
    replyTarget.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      id,
    });
  }
}

self.addEventListener('message', (event) => {
  // Handle REGISTER_PORT specially — the port itself is a Transferable in event.ports
  if (event.data && event.data.action === 'REGISTER_PORT') {
    const port = event.ports[0] ?? event.data.port;
    const msg = { ...event.data, port };
    handleMessage(msg, self);
    return;
  }
  handleMessage(event.data, self);
});
`;
