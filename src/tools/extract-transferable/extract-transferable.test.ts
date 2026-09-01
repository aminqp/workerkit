import { describe, it, expect } from 'vitest';
import { extractTransferable } from './extract-transferable';

describe('extractTransferable', () => {
  it('returns empty array for primitives', () => {
    expect(extractTransferable(null)).toEqual([]);
    expect(extractTransferable(undefined)).toEqual([]);
    expect(extractTransferable(42)).toEqual([]);
    expect(extractTransferable('string')).toEqual([]);
    expect(extractTransferable(true)).toEqual([]);
  });

  it('extracts ArrayBuffer directly', () => {
    const buffer = new ArrayBuffer(8);
    expect(extractTransferable(buffer)).toEqual([buffer]);
  });

  it('extracts MessagePort directly', () => {
    const { port1 } = new MessageChannel();
    expect(extractTransferable(port1)).toEqual([port1]);
  });

  it('extracts underlying buffer from TypedArrays', () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(extractTransferable(arr)).toEqual([arr.buffer]);
  });

  it('extracts buffer from DataView', () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    expect(extractTransferable(view)).toEqual([buffer]);
  });

  it('extracts transferables from nested objects', () => {
    const buffer1 = new ArrayBuffer(8);
    const buffer2 = new ArrayBuffer(16);
    const obj = {
      level1: {
        buf: buffer1,
        str: 'hello',
      },
      level2: buffer2,
      level3: 42,
    };
    const result = extractTransferable(obj);
    expect(result).toHaveLength(2);
    expect(result).toContain(buffer1);
    expect(result).toContain(buffer2);
  });

  it('extracts transferables from arrays of objects', () => {
    const buffer1 = new ArrayBuffer(8);
    const arr = new Uint16Array([1, 2]);
    const list = [{ a: buffer1 }, { b: 'str' }, arr];
    const result = extractTransferable(list);
    expect(result).toHaveLength(2);
    expect(result).toContain(buffer1);
    expect(result).toContain(arr.buffer);
  });

  it('handles cyclic structures without throwing', () => {
    const buffer = new ArrayBuffer(8);
    const cyclicObj: { buf: ArrayBuffer; self?: unknown } = { buf: buffer };
    cyclicObj.self = cyclicObj;

    const result = extractTransferable(cyclicObj);
    expect(result).toEqual([buffer]);
  });
});
