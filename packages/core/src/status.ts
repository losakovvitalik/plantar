import type { SshConnection } from "@plantar/ssh";
import { extractPm2Json, parsePm2Jlist } from "./discover";

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

/** Здоровье pm2-процесса приложения — для вкладки «Статус» */
export interface Pm2ProcessHealth {
  /** online, stopped, errored, … */
  status: string;
  /** Момент запуска процесса (unix-миллисекунды); нет — процесс не работает */
  startedAt?: number;
  /** Перезапусков с момента добавления процесса в pm2 */
  restarts?: number;
  /** Текущая нагрузка процесса; есть только у работающего */
  cpuPercent?: number;
  memoryMb?: number;
}

interface RawHealthProcess {
  name?: string;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    pmx_module?: boolean;
  };
}

/** Разбирает pm2 jlist в карту «имя процесса → здоровье» */
export function parsePm2Health(stdout: string): Map<string, Pm2ProcessHealth> {
  const map = new Map<string, Pm2ProcessHealth>();
  for (const proc of extractPm2Json(stdout) as RawHealthProcess[]) {
    const env = proc.pm2_env ?? {};
    if (!proc.name || env.pmx_module) continue;
    const online = env.status === "online" || env.status === "launching";
    map.set(proc.name, {
      status: env.status ?? "unknown",
      startedAt: online ? env.pm_uptime : undefined,
      restarts: env.restart_time,
      cpuPercent: online ? proc.monit?.cpu : undefined,
      memoryMb:
        online && proc.monit?.memory
          ? Math.round(proc.monit.memory / 1024 / 1024)
          : undefined,
    });
  }
  return map;
}

/** Здоровье всех pm2-процессов сервера; пустая карта — pm2 недоступен */
export async function pm2ProcessHealth(
  conn: SshConnection,
): Promise<Map<string, Pm2ProcessHealth>> {
  const jlist = await conn.exec("pm2 jlist 2>/dev/null");
  if (jlist.code !== 0) return new Map();
  return parsePm2Health(jlist.stdout);
}
