/**
 * Recursively extracts transferable objects from a given payload to optimize Web Worker messages.
 *
 * Transferable objects (like `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`)
 * are transferred by reference rather than being copied via Structured Clone, which significantly
 * reduces memory usage and improves performance when sending large datasets.
 *
 * This utility traverses arrays, objects, and nested structures to collect all valid transferables.
 * It also intelligently handles circular references by maintaining a `seen` Set.
 *
 * @param value - The input value to scan for transferable objects.
 * @param seen - An optional Set used internally to track visited objects and prevent infinite recursion in cyclic structures.
 * @returns An array containing all unique transferable objects found within the value.
 */
export function extractTransferable(
  value: unknown,
  seen = new Set<object>(),
): Transferable[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);

  if (
    value instanceof ArrayBuffer ||
    value instanceof MessagePort ||
    (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
  ) {
    return [value as Transferable];
  }

  if (ArrayBuffer.isView(value)) {
    return [value.buffer];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTransferable(item, seen));
  }

  return Object.values(value as object).flatMap((propertyValue) =>
    extractTransferable(propertyValue, seen),
  );
}
