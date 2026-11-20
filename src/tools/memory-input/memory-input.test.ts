import { describe, it, expect } from 'vitest';
import {
  READS_MEMORY_INPUT,
  memoryInput,
  noteMemoryInputReader,
  readsMemoryInput,
} from './memory-input';

describe('memory input', () => {
  it('workers generated from `func` always read memory input themselves', () => {
    expect(readsMemoryInput({})).toBe(true);
  });

  it('a bundled worker reads memory input only once it has said so in a reply', () => {
    const createWorker = () => ({}) as Worker;
    expect(readsMemoryInput({ createWorker })).toBe(false);

    // A hand-written worker's reply carries no marker
    noteMemoryInputReader(createWorker, { ok: true, data: 1 });
    expect(readsMemoryInput({ createWorker })).toBe(false);

    // defineWorker's replies do
    noteMemoryInputReader(createWorker, {
      ok: true,
      __memory_ref__: 'mem_1',
      [READS_MEMORY_INPUT]: true,
    });
    expect(readsMemoryInput({ createWorker })).toBe(true);
    // ...for that factory function only
    expect(readsMemoryInput({ createWorker: () => ({}) as Worker })).toBe(
      false,
    );
  });

  it('builds placeholders for a whole value or one part', () => {
    expect(memoryInput('mem_1')).toEqual({
      __memory_input__: { ref: 'mem_1' },
    });
    expect(memoryInput('mem_1', { index: 2, count: 4 })).toEqual({
      __memory_input__: { ref: 'mem_1', part: { index: 2, count: 4 } },
    });
  });
});
