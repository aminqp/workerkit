/**
 * Recursively extracts transferable objects from a given payload to optimize Web Worker messages.
 *
 * Transferable objects (like `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`)
 * are transferred by reference rather than being copied via Structured Clone, which significantly
 * reduces memory usage and improves performance when sending large datasets.
 *
 * This utility traverses arrays, objects, and nested structures to collect all valid transferables.
 * It handles circular references by tracking visited objects, and returns each transferable only
 * once: several views over one `ArrayBuffer` yield that buffer a single time, because a transfer
 * list with duplicate entries makes `postMessage` throw a `DataCloneError`.
 *
 * @param value - The input value to scan for transferable objects.
 * @param seen - An optional Set used internally to track visited objects and prevent infinite recursion in cyclic structures.
 * @returns An array containing all unique transferable objects found within the value.
 */
export function extractTransferable(
  value: unknown,
  seen = new Set<object>(),
): Transferable[] {
  const found = new Set<Transferable>();
  collect(value, seen, found);
  return Array.from(found);
}

function collect(
  value: unknown,
  seen: Set<object>,
  found: Set<Transferable>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (
    value instanceof ArrayBuffer ||
    value instanceof MessagePort ||
    (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
  ) {
    found.add(value as Transferable);
    return;
  }

  if (ArrayBuffer.isView(value)) {
    found.add(value.buffer as ArrayBuffer);
    return;
  }

  const children = Array.isArray(value)
    ? value
    : Object.values(value as object);
  for (const child of children) collect(child, seen, found);
}
