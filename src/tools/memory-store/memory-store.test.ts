import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './memory-store';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('registers a refId with optional metadata', () => {
    const customId = 'my-custom-ref';

    store.register(customId, { size: 1024, type: 'array' });

    expect(store.has(customId)).toBe(true);
    // There is no get method on the registry to retrieve metadata publicly,
    // so we just verify it doesn't throw and is registered.
  });

  it('correctly reports if it has a refId', () => {
    store.register('test-id');
    expect(store.has('test-id')).toBe(true);
    expect(store.has('missing-id')).toBe(false);
  });

  it('deletes a refId and returns boolean status', () => {
    store.register('test-id');
    expect(store.has('test-id')).toBe(true);

    const success = store.delete('test-id');
    expect(success).toBe(true);
    expect(store.has('test-id')).toBe(false);

    const fail = store.delete('test-id');
    expect(fail).toBe(false);
  });

  it('clears all entries', () => {
    store.register('id1');
    store.register('id2');

    expect(store.has('id1')).toBe(true);
    expect(store.has('id2')).toBe(true);

    store.clear();

    expect(store.has('id1')).toBe(false);
    expect(store.has('id2')).toBe(false);
    expect(store.stats().count).toBe(0);
  });

  it('returns accurate stats about current storage', () => {
    store.register('id1');
    store.register('id2');

    const stats = store.stats();
    expect(stats.count).toBe(2);
    expect(stats.refs).toEqual(['id1', 'id2']);
  });
});
