/** Нечёткое совпадение: все символы запроса встречаются в строке в том же порядке.
    Пустой запрос совпадает с чем угодно. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  if (q.length === 0) return true;
  const t = target.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}
