/**
 * Runs `fn` over `items` with at most `limit` calls in flight, preserving
 * the order of results. Used to parallelize independent SSH commands while
 * keeping the number of open channels modest: every parallel `exec` on a
 * pooled connection opens its own channel, and typical sshd `MaxSessions=10`
 * answers the excess with "Channel open failure".
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
