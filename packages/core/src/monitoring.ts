import { type SshConnection, shellQuote } from "@plantar/ssh";
import { t } from "./messages";

/**
 * Опциональные инструменты мониторинга на сервере. Оба ставятся из
 * репозитория Ubuntu по явному выбору пользователя:
 * - GoAccess разбирает access-логи nginx по запросу — посещаемость приложения;
 * - Netdata пишет историю нагрузки сервера и отдаёт её локальным HTTP API.
 */
export type MonitoringTool = "goaccess" | "netdata";

/** Что из мониторинга установлено на сервере */
export interface MonitoringStatus {
  /** Версия или null — не установлен */
  goaccess: string | null;
  netdata: string | null;
  /** Netdata установлен, но служба не отвечает */
  netdataDown: boolean;
}

// Netdata слушает только localhost — запросы идут по SSH, наружу порт не открыт
const NETDATA_API = "http://127.0.0.1:19999/api/v1";
const NETDATA_INFO = `curl -sf --max-time 5 '${NETDATA_API}/info'`;

async function run(
  conn: SshConnection,
  command: string,
  log: (line: string) => void,
): Promise<void> {
  log(`$ ${command}`);
  const result = await conn.exec(command);
  if (result.code !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-3000);
    throw new Error(t("commandFailed", { code: result.code, command, stderr: output }));
  }
}

export async function getMonitoringStatus(conn: SshConnection): Promise<MonitoringStatus> {
  // Первая строка вывода: "GoAccess - 1.5.4."
  const goaccess = await conn.exec("goaccess --version 2>/dev/null");
  const goaccessVersion =
    goaccess.code === 0
      ? (goaccess.stdout.match(/\d+(?:\.\d+)+/)?.[0] ?? goaccess.stdout.trim())
      : null;

  const info = await conn.exec(NETDATA_INFO);
  if (info.code === 0) {
    let version = "";
    try {
      version = String((JSON.parse(info.stdout) as { version?: string }).version ?? "");
    } catch {
      /* нестандартный ответ — главное, что служба отвечает */
    }
    return {
      goaccess: goaccessVersion,
      netdata: version.replace(/^v/, ""),
      netdataDown: false,
    };
  }

  // Служба не отвечает — установлен ли netdata вообще?
  const binary = await conn.exec("netdata -v 2>/dev/null");
  return {
    goaccess: goaccessVersion,
    netdata:
      binary.code === 0 ? binary.stdout.trim().replace(/^netdata\s*v?/i, "") : null,
    netdataDown: binary.code === 0,
  };
}

/**
 * Устанавливает инструмент мониторинга; уже установленный не трогает.
 * Netdata после установки привязывается к 127.0.0.1: метрики нужны только
 * Plantar по SSH, наружу служба не открывается. Конфиг перезаписывается
 * только при свежей установке — чужие настройки не трогаем.
 */
export async function installMonitoringTool(
  conn: SshConnection,
  tool: MonitoringTool,
  log: (line: string) => void = () => {},
): Promise<void> {
  const status = await getMonitoringStatus(conn);
  const installedVersion = tool === "goaccess" ? status.goaccess : status.netdata;

  if (installedVersion !== null && !(tool === "netdata" && status.netdataDown)) {
    log(t("toolPresent", { tool, version: installedVersion }));
    return;
  }

  if (installedVersion === null) {
    log(t("toolInstalling", { tool }));
    await run(conn, "apt-get update", log);
    await run(conn, `DEBIAN_FRONTEND=noninteractive apt-get install -y ${tool}`, log);

    if (tool === "netdata") {
      // Минимальный конфиг: только localhost, без ML-анализа — экономим ресурсы
      const conf = `[web]\n    bind to = 127.0.0.1\n\n[ml]\n    enabled = no`;
      await run(
        conn,
        `cat > /etc/netdata/netdata.conf <<'PLANTAR_EOF'\n${conf}\nPLANTAR_EOF`,
        log,
      );
    }
  }

  if (tool === "netdata") {
    await run(conn, "systemctl enable --now netdata && systemctl restart netdata", log);
    // Службе нужно несколько секунд, чтобы поднять HTTP API
    let up = false;
    for (let attempt = 0; attempt < 10 && !up; attempt++) {
      up = (await conn.exec(`sleep 1; ${NETDATA_INFO}`)).code === 0;
    }
    if (!up) throw new Error(t("netdataNotResponding"));
  }

  const version = tool === "goaccess" ? (await getMonitoringStatus(conn)).goaccess : "";
  log(t("toolInstalled", { tool, version: version || tool }));
}

/** Сводка посещаемости приложения из access-лога nginx */
export interface TrafficStats {
  /** У приложения нет собственного access-лога (внешний конфиг без access_log
   *  или ещё не было деплоя) — посещения не записываются вовсе */
  logMissing?: boolean;
  totalHits: number;
  totalVisitors: number;
  /** По дням за хранимый период лога, старые сначала; date — yyyy-mm-dd */
  byDay: Array<{ date: string; hits: number; visitors: number }>;
  /** Распределение запросов по часам суток; ровно 24 элемента */
  byHour: Array<{ hour: number; hits: number }>;
  /** Ответы по группам кодов: 2xx, 3xx, 4xx, 5xx */
  statusCodes: Array<{ family: string; hits: number }>;
  /** Самые запрашиваемые страницы */
  topPaths: Array<{ path: string; hits: number }>;
}

const EMPTY_TRAFFIC: TrafficStats = {
  totalHits: 0,
  totalVisitors: 0,
  byDay: [],
  byHour: [],
  statusCodes: [],
  topPaths: [],
};

/** Числа в JSON GoAccess: в новых версиях {count}, в старых — просто число */
function count(value: unknown): number {
  if (typeof value === "number") return value;
  const nested = (value as { count?: number } | undefined)?.count;
  return typeof nested === "number" ? nested : 0;
}

interface GoaccessRow {
  data?: string;
  hits?: unknown;
  visitors?: unknown;
}

/** Разбирает JSON-отчёт GoAccess в сводку для графиков */
export function parseGoaccessReport(json: string): TrafficStats {
  let report: {
    general?: { total_requests?: unknown; unique_visitors?: unknown };
    visitors?: { data?: GoaccessRow[] };
    visit_time?: { data?: GoaccessRow[] };
    status_codes?: { data?: GoaccessRow[] };
    requests?: { data?: GoaccessRow[] };
  };
  try {
    report = JSON.parse(json);
  } catch {
    return EMPTY_TRAFFIC;
  }

  const byDay = (report.visitors?.data ?? [])
    .flatMap((row) => {
      const match = (row.data ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!match) return [];
      return [
        {
          date: `${match[1]}-${match[2]}-${match[3]}`,
          hits: count(row.hits),
          visitors: count(row.visitors),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const hourHits = new Map(
    (report.visit_time?.data ?? []).map((row) => [Number(row.data), count(row.hits)]),
  );
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    hits: hourHits.get(hour) ?? 0,
  }));

  const statusCodes = (report.status_codes?.data ?? [])
    .flatMap((row) => {
      const family = (row.data ?? "").match(/^[1-5]xx/i)?.[0].toLowerCase();
      return family ? [{ family, hits: count(row.hits) }] : [];
    })
    .sort((a, b) => a.family.localeCompare(b.family));

  const topPaths = (report.requests?.data ?? [])
    .filter((row) => row.data)
    .slice(0, 8)
    .map((row) => ({ path: row.data!, hits: count(row.hits) }));

  return {
    totalHits: count(report.general?.total_requests),
    totalVisitors: count(report.general?.unique_visitors),
    byDay,
    byHour,
    statusCodes,
    topPaths,
  };
}

/**
 * Посещаемость приложения: GoAccess разбирает access-лог nginx вместе с
 * ротированными копиями (~2 недели при стандартном logrotate). Пустой или
 * отсутствующий лог — не ошибка: возвращается пустая сводка.
 */
export async function getTrafficStats(
  conn: SshConnection,
  accessLogPath: string,
): Promise<TrafficStats> {
  const goaccess = await conn.exec("command -v goaccess");
  if (goaccess.code !== 0) throw new Error(t("goaccessMissing"));

  const base = shellQuote(accessLogPath);
  // Лога нет совсем (ни текущего, ни ротированных) — посещения не записываются;
  // это не «пока пусто», и интерфейс должен объяснить разницу
  const anyLog = await conn.exec(`ls -- ${base} ${base}.1 ${base}.*.gz 2>/dev/null | head -1`);
  if (anyLog.stdout.trim() === "") return { ...EMPTY_TRAFFIC, logMissing: true };

  // Текущий лог и вчерашний — несжатые, старше — .gz; кавычки не мешают глобу
  const result = await conn.exec(
    `{ cat ${base} ${base}.1 2>/dev/null; zcat -- ${base}.*.gz 2>/dev/null; } | ` +
      `goaccess - --log-format=COMBINED -o json 2>/dev/null`,
  );
  if (result.code !== 0) return EMPTY_TRAFFIC;
  return parseGoaccessReport(result.stdout);
}

/** Точка истории нагрузки сервера */
export interface ServerMetricPoint {
  /** unix-секунды */
  time: number;
  value: number;
}

/** История нагрузки сервера из Netdata */
export interface ServerMetrics {
  /** Использование процессора, % (0–100) */
  cpu: ServerMetricPoint[];
  /** Занятая память, МБ (без дискового кэша) */
  ramUsed: ServerMetricPoint[];
  ramTotalMb: number;
}

interface NetdataData {
  labels?: string[];
  data?: Array<Array<number | null>>;
}

/** Ряды без пропусков, по возрастанию времени */
function netdataRows(raw: NetdataData): Array<number[]> {
  return (raw.data ?? [])
    .filter((row): row is number[] => row.every((v) => v !== null))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * История нагрузки сервера за последние `seconds` секунд. Требует работающего
 * Netdata: без него бросает понятную ошибку.
 */
export async function getServerMetrics(
  conn: SshConnection,
  seconds: number,
): Promise<ServerMetrics> {
  const query = (chart: string) =>
    conn.exec(
      `curl -sf --max-time 10 '${NETDATA_API}/data?chart=${chart}` +
        `&after=-${Math.round(seconds)}&points=120&group=average&format=json'`,
    );

  const [cpuResult, ramResult] = [await query("system.cpu"), await query("system.ram")];
  if (cpuResult.code !== 0 || ramResult.code !== 0) {
    throw new Error(t("netdataNotResponding"));
  }

  let cpuRaw: NetdataData;
  let ramRaw: NetdataData;
  try {
    cpuRaw = JSON.parse(cpuResult.stdout);
    ramRaw = JSON.parse(ramResult.stdout);
  } catch {
    throw new Error(t("netdataNotResponding"));
  }

  // system.cpu — проценты по составляющим; занятость = 100 − idle
  const idleIndex = (cpuRaw.labels ?? []).indexOf("idle");
  const cpu = netdataRows(cpuRaw).map((row) => ({
    time: row[0],
    value:
      Math.round(
        (idleIndex > 0
          ? Math.min(100, Math.max(0, 100 - row[idleIndex]))
          : row.slice(1).reduce((sum, v) => sum + v, 0)) * 10,
      ) / 10,
  }));

  // system.ram в МиБ: free / used / cached / buffers; всего — их сумма
  const usedIndex = (ramRaw.labels ?? []).indexOf("used");
  const ramRows = netdataRows(ramRaw);
  const ramUsed = ramRows.map((row) => ({
    time: row[0],
    value: usedIndex > 0 ? Math.round(row[usedIndex]) : 0,
  }));
  const last = ramRows.at(-1);
  const ramTotalMb = last ? Math.round(last.slice(1).reduce((sum, v) => sum + v, 0)) : 0;

  return { cpu, ramUsed, ramTotalMb };
}
