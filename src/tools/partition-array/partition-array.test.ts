import { describe, it, expect } from 'vitest';
import { partitionArray } from './partition-array';

describe('partitionArray', () => {
  it('returns empty array when input is empty', () => {
    expect(partitionArray([], 4)).toEqual([]);
  });

  it('throws an error if numChunks is less than or equal to 0', () => {
    expect(() => partitionArray([1, 2, 3], 0)).toThrow(
      'numChunks must be positive',
    );
    expect(() => partitionArray([1, 2, 3], -1)).toThrow(
      'numChunks must be positive',
    );
  });

  it('partitions array exactly evenly', () => {
    const input = [1, 2, 3, 4];
    expect(partitionArray(input, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('distributes remainder elements to earlier chunks', () => {
    const input = [1, 2, 3, 4, 5];

    // 5 items, 2 chunks => size 2 remainder 1 => chunks: 3, 2
    expect(partitionArray(input, 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);

    // 5 items, 3 chunks => size 1 remainder 2 => chunks: 2, 2, 1
    expect(partitionArray(input, 3)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('creates single-item chunks if numChunks exceeds array length', () => {
    const input = [1, 2];

    // Requesting 5 chunks for 2 items => returns 2 chunks of size 1
    expect(partitionArray(input, 5)).toEqual([[1], [2]]);
  });
});
