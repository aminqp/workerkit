/**
 * MemoryStore provides a centralized in-memory caching mechanism, typically run inside
 * a dedicated Web Worker (`MemoryWorker`). It allows large datasets to be loaded once
 * into RAM and reused across multiple worker executions without constant serialization.
 *
 * It uses a `Map` where each dataset is indexed by a cryptographically generated
 * UUID (`__memory_ref__`) to ensure collision-free, secure handle management.
 */
export class MemoryStore {
  private readonly store = new Map<string, unknown>();

  /**
   * Stores a dataset in RAM under an unguessable reference ID.
   *
   * @param data - The dataset to store.
   * @param refId - Optional reference ID; if omitted, a UUID will be generated.
   * @returns The reference ID under which the dataset is stored.
   */
  set(data: unknown, refId?: string): string {
    const id = refId ?? `mem_${crypto.randomUUID()}`;
    this.store.set(id, data);
    return id;
  }

  /**
   * Retrieves a dataset from RAM by its reference ID.
   *
   * @param refId - The reference ID to retrieve.
   * @returns The stored dataset, or undefined if not found.
   */
  get(refId: string): unknown {
    return this.store.get(refId);
  }

  /**
   * Deletes a dataset reference from RAM.
   *
   * @param refId - The reference ID to delete.
   * @returns `true` if the key existed and was removed, `false` otherwise.
   */
  delete(refId: string): boolean {
    return this.store.delete(refId);
  }

  /**
   * Clears all dataset handles from RAM.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Checks if a reference ID exists in RAM.
   */
  has(refId: string): boolean {
    return this.store.has(refId);
  }

  /**
   * Returns statistics about current memory handles.
   */
  stats(): { count: number; refs: string[] } {
    return {
      count: this.store.size,
      refs: Array.from(this.store.keys()),
    };
  }
}
