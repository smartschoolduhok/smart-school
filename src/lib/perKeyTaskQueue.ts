export interface PerKeyTaskQueue<Key> {
  enqueue<Result>(key: Key, task: () => Promise<Result>): Promise<Result>;
  hasPending(key: Key): boolean;
}

export function createPerKeyTaskQueue<Key>(): PerKeyTaskQueue<Key> {
  const tails = new Map<Key, Promise<void>>();

  return {
    enqueue<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(key, tail);

      return result.finally(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
    },

    hasPending(key: Key): boolean {
      return tails.has(key);
    },
  };
}

export function mergeUpdatedRow<T extends { id: number }>(
  rows: readonly T[],
  updated: Partial<T> & Pick<T, 'id'>,
): T[] {
  return rows.map(row => row.id === updated.id ? { ...row, ...updated } : row);
}
