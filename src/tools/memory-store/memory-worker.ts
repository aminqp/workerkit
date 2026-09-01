/**
 * Script source for the dedicated MemoryWorker thread.
 *
 * Runs inside an isolated Web Worker thread and maintains the MemoryStore.
 * Handshakes and authenticates all incoming MessagePort requests using a secret `factoryToken`.
 */
export const memoryWorkerScript = `
const store = new Map();

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  const { action, factoryToken, expectedToken, ref, data, id } = msg;

  // Initial handshake to set expected token if needed
  if (action === 'INIT_TOKEN') {
    self.__expectedToken = expectedToken;
    self.postMessage({ ok: true, action: 'INIT_TOKEN_ACK' });
    return;
  }

  // Validate factory token
  if (self.__expectedToken && factoryToken !== self.__expectedToken) {
    self.postMessage({ ok: false, error: 'Unauthorized: invalid factory token', id });
    return;
  }

  try {
    switch (action) {
      case 'SET': {
        const refId = ref || ('mem_' + crypto.randomUUID());
        store.set(refId, data);
        self.postMessage({ ok: true, ref: refId, id });
        break;
      }
      case 'GET': {
        const resultData = store.get(ref);
        const exists = store.has(ref);
        self.postMessage({ ok: true, exists, data: resultData, ref, id });
        break;
      }
      case 'DELETE': {
        const deleted = store.delete(ref);
        self.postMessage({ ok: true, deleted, ref, id });
        break;
      }
      case 'CLEAR': {
        store.clear();
        self.postMessage({ ok: true, action: 'CLEAR_ACK', id });
        break;
      }
      case 'STATS': {
        self.postMessage({
          ok: true,
          stats: {
            count: store.size,
            refs: Array.from(store.keys()),
          },
          id,
        });
        break;
      }
      default:
        self.postMessage({ ok: false, error: 'Unknown action: ' + action, id });
    }
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      id,
    });
  }
});
`;
