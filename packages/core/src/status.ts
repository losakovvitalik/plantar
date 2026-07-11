import type { SshConnection } from "@plantar/ssh";
import { parsePm2Jlist } from "./discover";

/**
 * Статусы pm2-процессов сервера одним запросом: имя процесса → статус
 * (online, stopped, errored, …). Пустая карта — pm2 недоступен, значит
 * pm2-приложения на сервере не запущены.
 */
export async function pm2ProcessStatuses(
  conn: SshConnection,
): Promise<Map<string, string>> {
  const jlist = await conn.exec("pm2 jlist 2>/dev/null");
  if (jlist.code !== 0) return new Map();
  return new Map(parsePm2Jlist(jlist.stdout).map((proc) => [proc.name, proc.status]));
}
