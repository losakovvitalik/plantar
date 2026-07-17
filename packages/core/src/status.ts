import { type SshConnection, shellQuote } from "@plantar/ssh";
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

/**
 * Отвечает ли сайт по коду ответа: редиректы и коды авторизации — отвечает;
 * 502/503/504 — прокси не достучался до приложения, пусто/000 — ответа нет.
 * Та же логика, что в смоук-проверке после деплоя.
 */
export function siteResponds(code: string): boolean {
  return !["", "000", "502", "503", "504"].includes(code);
}

/** Разбирает вывод проверки сайтов (строки «номер код») в ответы по порядку urls */
export function parseSiteChecks(stdout: string, count: number): boolean[] {
  const codes = new Map<number, string>();
  for (const line of stdout.trim().split("\n")) {
    const [index, code] = line.split(" ");
    codes.set(Number(index), code ?? "");
  }
  return Array.from({ length: count }, (_, i) => siteResponds(codes.get(i) ?? ""));
}

/**
 * Живая проверка сайтов приложений: запрос к каждому адресу с самого сервера,
 * чтобы проверить всю цепочку nginx → приложение (без влияния DNS и сети
 * пользователя). Все адреса проверяются параллельно одним ssh-вызовом.
 */
export async function checkSitesRespond(
  conn: SshConnection,
  urls: string[],
): Promise<boolean[]> {
  if (urls.length === 0) return [];
  // -k: проверяем доступность, а не сертификат; каждая проверка печатает
  // свою строку «номер код» — короткие echo пишутся атомарно
  const checks = urls
    .map(
      (url, i) =>
        `{ code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 ${shellQuote(url)} 2>/dev/null); echo "${i} $code"; } &`,
    )
    .join(" ");
  const result = await conn.exec(`${checks} wait`);
  return parseSiteChecks(result.stdout, urls.length);
}
