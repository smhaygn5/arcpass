export function createKeyedTaskQueue() {
  const tails = new Map<string, Promise<void>>();

  return async function runExclusive<T>(key: string, task: () => Promise<T>) {
    const previous = tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
    tails.set(key, current);
    await previous;
    try {
      return await task();
    } finally {
      release?.();
      if (tails.get(key) === current) tails.delete(key);
    }
  };
}
