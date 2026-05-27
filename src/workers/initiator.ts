/**o with
 * Default initiator — a minimal echo worker used as a no-op placeholder.
 *
 * When no custom initiator is passed to `MainWorkerFactory`, this function
 * is used. It simply reflects every incoming message back to the sender,
 * which is useful for testing the messaging pipeline without any real
 * computation.
 *
 * @example
 * // Automatically used as the default:
 * new MainWorkerFactory({ workers: [...] });
 *
 * // Equivalent explicit usage:
 * import defaultInitiator from './initiator';
 * new MainWorkerFactory({ workers: [...] }, defaultInitiator);
 */
export default () => {
  self.addEventListener('message', (event) => {
    self.postMessage(event.data);
  });
};
