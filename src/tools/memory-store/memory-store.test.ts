import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryStore } from './memory-store';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('sets a value and auto-generates a refId if not provided', () => {
    const data = { heavy: 'dataset' };

    const randomUUIDSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(
        '1234-abcd' as `${string}-${string}-${string}-${string}-${string}`,
      );

    const id = store.set(data);

    expect(id).toBe('mem_1234-abcd');
    expect(store.get('mem_1234-abcd')).toBe(data);

    randomUUIDSpy.mockRestore();
  });

  it('sets a value with a specifically provided refId', () => {
    const data = [1, 2, 3];
    const customId = 'my-custom-ref';

    const id = store.set(data, customId);

    expect(id).toBe(customId);
    expect(store.get(customId)).toBe(data); // Reference equality is preserved
  });

  it('returns undefined when getting a non-existent refId', () => {
    expect(store.get('non-existent')).toBeUndefined();
  });

  it('correctly reports if it has a refId', () => {
    store.set('value', 'test-id');
    expect(store.has('test-id')).toBe(true);
    expect(store.has('missing-id')).toBe(false);
  });

  it('deletes a refId and returns boolean status', () => {
    store.set('value', 'test-id');
    expect(store.has('test-id')).toBe(true);

    const success = store.delete('test-id');
    expect(success).toBe(true);
    expect(store.has('test-id')).toBe(false);
    expect(store.get('test-id')).toBeUndefined();

    const fail = store.delete('test-id');
    expect(fail).toBe(false);
  });

  it('clears all entries', () => {
    store.set('val1', 'id1');
    store.set('val2', 'id2');

    expect(store.has('id1')).toBe(true);
    expect(store.has('id2')).toBe(true);

    store.clear();

    expect(store.has('id1')).toBe(false);
    expect(store.has('id2')).toBe(false);
    expect(store.stats().count).toBe(0);
  });

  it('returns accurate stats about current storage', () => {
    store.set('val1', 'id1');
    store.set('val2', 'id2');

    const stats = store.stats();
    expect(stats.count).toBe(2);
    expect(stats.refs).toEqual(['id1', 'id2']);
  });
});
