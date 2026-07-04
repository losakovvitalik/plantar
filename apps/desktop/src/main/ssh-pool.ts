import type { SshConnection } from "@plantar/ssh";

/** Простаивающее соединение закрывается через 2 минуты */
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

interface PoolEntry {
  connPromise: Promise<SshConnection>;
  /** Заполняется после успешного подключения — для синхронных проверок */
  conn: SshConnection | null;
  /** Число операций на соединении; пока > 0 — таймер простоя не заводится */
  refs: number;
  idleTimer?: NodeJS.Timeout;
}

const pool = new Map<string, PoolEntry>();

async function acquire(
  key: string,
  create: () => Promise<SshConnection>,
): Promise<SshConnection> {
  const existing = pool.get(key);
  if (existing) {
    clearTimeout(existing.idleTimer);
    const conn = await existing.connPromise.catch(() => null);
    if (conn?.alive) {
      // Пока ждали promise, параллельный release мог завести таймер — снимаем ещё раз
      clearTimeout(existing.idleTimer);
      existing.idleTimer = undefined;
      existing.refs++;
      return conn;
    }
    if (pool.get(key) === existing) pool.delete(key);
  }

  const entry: PoolEntry = { connPromise: create(), conn: null, refs: 1 };
  pool.set(key, entry);
  try {
    entry.conn = await entry.connPromise;
    return entry.conn;
  } catch (err) {
    if (pool.get(key) === entry) pool.delete(key);
    throw err;
  }
}

function release(key: string): void {
  const entry = pool.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;
  entry.idleTimer = setTimeout(() => {
    pool.delete(key);
    entry.conn?.close();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Выполняет операцию на соединении из пула. Живое соединение переиспользуется,
 * новое создаётся через create() только когда живого нет. После операции
 * соединение не закрывается — остаётся в пуле до таймаута простоя.
 */
export async function withPooledConnection<T>(
  key: string,
  create: () => Promise<SshConnection>,
  fn: (conn: SshConnection) => Promise<T>,
): Promise<T> {
  const conn = await acquire(key, create);
  try {
    return await fn(conn);
  } finally {
    release(key);
  }
}

/** Есть ли живое соединение — тогда операция не потребует пароля */
export function isConnected(key: string): boolean {
  return pool.get(key)?.conn?.alive ?? false;
}

/** Закрывает соединение и убирает его из пула (например, при удалении сервера) */
export function dropConnection(key: string): void {
  const entry = pool.get(key);
  if (!entry) return;
  pool.delete(key);
  clearTimeout(entry.idleTimer);
  void entry.connPromise.then((conn) => conn.close()).catch(() => {});
}
