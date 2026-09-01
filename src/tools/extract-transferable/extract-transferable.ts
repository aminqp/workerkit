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
