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
  /** Включён сбор метрик приложений: сборщик с cron на месте и Netdata отвечает */
  appMetrics: boolean;
}

// Netdata слушает только localhost — запросы идут по SSH, наружу порт не открыт
const NETDATA_API = "http://127.0.0.1:19999/api/v1";
const NETDATA_INFO = `curl -sf --max-time 5 '${NETDATA_API}/info'`;

/** Конфиг Netdata, который писали прежние версии Plantar, — узнаём его, чтобы обновить */
const NETDATA_LEGACY_CONF = `[web]\n    bind to = 127.0.0.1\n\n[ml]\n    enabled = no`;

/**
 * Облегчённый конфиг Netdata: только localhost, без ML-анализа, алертов и
 * лишних сборщиков — служба заметно меньше ест память и процессор. Данные
 * серверных графиков (раздел proc) и приёмник statsd остаются включёнными.
 */
const NETDATA_LEAN_CONF = `[web]
    bind to = 127.0.0.1

[ml]
    enabled = no

[health]
    enabled = no

[global]
    update every = 2

[db]
    dbengine page cache size MB = 32

[plugins]
    statsd = yes
    go.d = no
    python.d = no
    charts.d = no
    apps = no
    cgroups = no
    tc = no
    idlejitter = no
    perf = no`;

const APP_METRICS_DIR = "/usr/local/lib/plantar";
const APP_METRICS_SCRIPT_PATH = `${APP_METRICS_DIR}/app-metrics.sh`;
const APP_METRICS_CRON_PATH = "/etc/cron.d/plantar-app-metrics";

/** Метрики приложения, которые пишет сборщик и читает Plantar */
type AppMetricName = "cpu" | "mem" | "out_lines" | "err_lines";

/**
 * Сборщик метрик приложений. Командные строки pm2-приложений неотличимы друг
 * от друга («npm start»), поэтому штатные средства Netdata не могут разнести
 * их по приложениям — принадлежность процессов знает только pm2. Скрипт раз
 * в минуту суммирует CPU/ОЗУ всего дерева процессов каждого приложения (сам
 * pm2 показывает лишь обёртку npm), считает прирост строк в его логах и
 * отдаёт в statsd-приёмник Netdata, который хранит историю и раздаёт её
 * по HTTP API.
 *
 * Экспорт — для синтаксической проверки в тестах.
 */
export const APP_METRICS_SCRIPT = `#!/bin/bash
# Потребление CPU/ОЗУ и активность логов pm2-приложений — в statsd-приёмник
# Netdata (UDP 8125). Файл устанавливает Plantar; запускает cron
# (${APP_METRICS_CRON_PATH}).
set -u

pids_dir="$HOME/.pm2/pids"
logs_dir="$HOME/.pm2/logs"
state_file="/var/lib/plantar/app-metrics.state"
logs_state="/var/lib/plantar/app-logs.state"
[ -d "$pids_dir" ] || exit 0
mkdir -p /var/lib/plantar

# Корни деревьев процессов: "имя pid" из pid-файлов pm2 (<имя>-<номер>.pid).
# Имена с пробелами не поддерживаются — их не пронести через конвейеры ниже.
roots=$(
  for f in "$pids_dir"/*.pid; do
    [ -e "$f" ] || continue
    name=$(basename "$f" .pid)
    name=\${name%-*}
    case "$name" in (*[[:space:]]*) continue ;; esac
    pid=$(tr -cd '0-9' < "$f" 2>/dev/null)
    [ -n "$pid" ] && [ -d "/proc/$pid" ] && printf '%s %s\\n' "$name" "$pid"
  done
)
# Пустой список — не повод выходить: приложения из прошлого замера надо обнулить
[ -n "$roots" ] || [ -s "$state_file" ] || exit 0

metrics=$(printf '%s\\n' "$roots" | awk \\
  -v now="$(date +%s)" -v clk="$(getconf CLK_TCK)" \\
  -v page_kb="$(( $(getconf PAGESIZE) / 1024 ))" -v state_file="$state_file" '
  # Вход: строки "имя pid" — корневые процессы приложений
  NF == 2 { gsub(/[^a-zA-Z0-9]/, "_", $1); app[$2] = tolower($1) }
  END {
    # Снимок всех процессов: ppid, jiffies (utime+stime) и RSS в страницах.
    # Имя процесса в /proc/*/stat может содержать пробелы и скобки —
    # хвост полей отсчитывается от последней ")".
    cmd = "cat /proc/[0-9]*/stat 2>/dev/null"
    while ((cmd | getline line) > 0) {
      pid = line + 0
      tail = substr(line, match(line, /\\)[^)]*$/) + 1)
      if (split(tail, f, " ") < 22) continue
      ppid[pid] = f[2]; jiff[pid] = f[12] + f[13]; rss[pid] = f[22]
    }
    close(cmd)

    # Процесс принадлежит приложению, чей корень встретился среди его предков
    for (pid in ppid) {
      p = pid
      for (depth = 0; depth < 64 && p > 1; depth++) {
        if (p in app) { tj[app[p]] += jiff[pid]; trss[app[p]] += rss[pid]; break }
        p = ppid[p]
      }
    }

    # Прошлые jiffies из state-файла — загрузка CPU считается за интервал
    while ((getline line < state_file) > 0) {
      split(line, s, " "); prev_j[s[1]] = s[2]; prev_t[s[1]] = s[3]
    }
    close(state_file)

    for (pid in app) {
      name = app[pid]
      if (name in done) continue
      done[name] = 1
      printf "plantar_apps.%s_mem:%d|g\\n", name, trss[name] * page_kb / 1024
      if ((name in prev_j) && prev_t[name] < now && tj[name] >= prev_j[name])
        printf "plantar_apps.%s_cpu:%.1f|g\\n", name,
          (tj[name] - prev_j[name]) / clk / (now - prev_t[name]) * 100
      print name, tj[name], now > (state_file ".tmp")
    }

    # Приложение из прошлого замера исчезло (остановлено или удалено) —
    # датчики обнуляются, иначе statsd вечно повторяет последнее значение
    for (name in prev_j) {
      if (name in done) continue
      printf "plantar_apps.%s_mem:0|g\\n", name
      printf "plantar_apps.%s_cpu:0|g\\n", name
      print name, prev_j[name], now > (state_file ".tmp")
    }
  }')

[ -f "$state_file.tmp" ] && mv "$state_file.tmp" "$state_file"

# Прирост строк в логах pm2 с прошлого запуска: читаются только новые байты
# (по сохранённому смещению), большие файлы не перечитываются целиком.
# Смещение больше файла — лог обрезали (ротация или деплой), считаем с нуля.
declare -A offset
if [ -f "$logs_state" ]; then
  while read -r file off; do
    [ -n "$file" ] && offset["$file"]=$off
  done < "$logs_state"
fi

log_metrics=""
new_log_state=""
for name in $(printf '%s\\n' "$roots" | cut -d' ' -f1 | sort -u); do
  sane=$(printf '%s' "$name" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '_')
  for kind in out err; do
    [ "$kind" = out ] && suffix=out || suffix=error
    total=""
    for f in "$logs_dir/$name-$suffix"*.log; do
      [ -e "$f" ] || continue
      size=$(wc -c < "$f" 2>/dev/null) || continue
      if [ -n "\${offset[$f]:-}" ]; then
        off=\${offset[$f]}
        [ "$off" -gt "$size" ] && off=0
        added=0
        [ $(( size - off )) -gt 0 ] && \\
          added=$(tail -c +$(( off + 1 )) "$f" | head -c $(( size - off )) | wc -l)
        total=$(( \${total:-0} + added ))
      fi
      new_log_state+="$f $size"$'\\n'
    done
    # Пусто — ни у одного файла не было прежнего смещения (первое знакомство)
    [ -n "$total" ] && log_metrics+="plantar_apps.\${sane}_\${kind}_lines:$total|g"$'\\n'
  done
done
# Без работающих приложений смещения не трогаем — иначе пустая запись их сотрёт
[ -n "$roots" ] && printf '%s' "$new_log_state" > "$logs_state"

# Приёмник недоступен — UDP-датаграммы просто теряются, это не ошибка
exec 3>/dev/udp/127.0.0.1/8125 2>/dev/null || exit 0
printf '%s\\n' "$metrics" >&3
[ -n "$log_metrics" ] && printf '%s' "$log_metrics" >&3
exec 3>&-`;

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

/** Ждёт, пока HTTP API Netdata поднимется после (пере)запуска службы */
async function waitForNetdata(conn: SshConnection): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await conn.exec(`sleep 1; ${NETDATA_INFO}`)).code === 0) return;
  }
  throw new Error(t("netdataNotResponding"));
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
    const collector = await conn.exec(
      `test -x ${APP_METRICS_SCRIPT_PATH} && test -f ${APP_METRICS_CRON_PATH}`,
    );
    return {
      goaccess: goaccessVersion,
      netdata: version.replace(/^v/, ""),
      netdataDown: false,
      appMetrics: collector.code === 0,
    };
  }

  // Служба не отвечает — установлен ли netdata вообще?
  const binary = await conn.exec("netdata -v 2>/dev/null");
  return {
    goaccess: goaccessVersion,
    netdata:
      binary.code === 0 ? binary.stdout.trim().replace(/^netdata\s*v?/i, "") : null,
    netdataDown: binary.code === 0,
    appMetrics: false,
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
      await run(
        conn,
        `cat > /etc/netdata/netdata.conf <<'PLANTAR_EOF'\n${NETDATA_LEAN_CONF}\nPLANTAR_EOF`,
        log,
      );
    }
  }

  if (tool === "netdata") {
    await run(conn, "systemctl enable --now netdata && systemctl restart netdata", log);
    await waitForNetdata(conn);
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

/** Потребление одного приложения в общей нагрузке сервера */
export interface ServerAppUsage {
  /** Имя проекта Plantar или имя метрики, если проект не добавлен */
  name: string;
  /** Загрузка процессора, % всех ядер — та же шкала, что у ряда сервера */
  cpu: ServerMetricPoint[];
  /** Занятая память дерева процессов, МБ */
  memMb: ServerMetricPoint[];
}

/** История нагрузки сервера из Netdata */
export interface ServerMetrics {
  /** Использование процессора, % (0–100) */
  cpu: ServerMetricPoint[];
  /** Занятая память, МБ (без дискового кэша) */
  ramUsed: ServerMetricPoint[];
  ramTotalMb: number;
  /** Разбивка по приложениям; пуста, пока не включён сбор метрик приложений */
  apps: ServerAppUsage[];
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
 * История нагрузки сервера за последние `seconds` секунд вместе с разбивкой
 * по приложениям (если включён сбор их метрик). Все ряды выровнены по общим
 * корзинам времени, поэтому их можно складывать в один стековый график.
 * Требует работающего Netdata: без него бросает понятную ошибку.
 *
 * `apps` — проекты Plantar этого сервера: их имена подписывают ряды разбивки.
 */
export async function getServerMetrics(
  conn: SshConnection,
  seconds: number,
  apps: Array<{ pm2Name: string; name: string }> = [],
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

  const bucket = seconds / 120;

  // system.cpu — проценты по составляющим; занятость = 100 − idle
  const idleIndex = (cpuRaw.labels ?? []).indexOf("idle");
  const cpu = downsampleAverage(
    netdataRows(cpuRaw).map((row) => ({
      time: row[0],
      value:
        idleIndex > 0
          ? Math.min(100, Math.max(0, 100 - row[idleIndex]))
          : row.slice(1).reduce((sum, v) => sum + v, 0),
    })),
    bucket,
  ).map((point) => ({ time: point.time, value: Math.round(point.value * 10) / 10 }));

  // system.ram в МиБ: free / used / cached / buffers; всего — их сумма
  const usedIndex = (ramRaw.labels ?? []).indexOf("used");
  const ramRows = netdataRows(ramRaw);
  const ramUsed = downsampleAverage(
    ramRows.map((row) => ({ time: row[0], value: usedIndex > 0 ? row[usedIndex] : 0 })),
    bucket,
  ).map((point) => ({ time: point.time, value: Math.round(point.value) }));
  const last = ramRows.at(-1);
  const ramTotalMb = last ? Math.round(last.slice(1).reduce((sum, v) => sum + v, 0)) : 0;

  return { cpu, ramUsed, ramTotalMb, apps: await queryAppsUsage(conn, seconds, apps) };
}

/**
 * Разбивка нагрузки сервера по приложениям из чартов сборщика. Ряды приводятся
 * к тем же корзинам времени, что и ряды сервера; CPU — из процентов одного
 * ядра (как считает сборщик) в проценты всех ядер (как ряд сервера).
 */
async function queryAppsUsage(
  conn: SshConnection,
  seconds: number,
  apps: Array<{ pm2Name: string; name: string }>,
): Promise<ServerAppUsage[]> {
  const chartIds = await fetchNetdataChartIds(conn);
  const groups = appGroupsFromChartIds(chartIds);
  if (groups.length === 0) return [];

  const cores = Math.max(1, Number((await conn.exec("nproc")).stdout.trim()) || 1);
  const titles = new Map(apps.map((app) => [appMetricsGroupName(app.pm2Name), app.name]));
  const bucket = seconds / 120;

  const usage: ServerAppUsage[] = [];
  for (const group of groups) {
    const cpu = await queryAppMetric(conn, chartIds, group, "cpu", seconds, 120);
    const memMb = await queryAppMetric(conn, chartIds, group, "mem", seconds, 120);
    if (cpu.length === 0 && memMb.length === 0) continue;
    usage.push({
      name: titles.get(group) ?? group,
      cpu: downsampleAverage(cpu, bucket).map((point) => ({
        time: point.time,
        value: Math.round((point.value / cores) * 10) / 10,
      })),
      memMb: downsampleAverage(memMb, bucket).map((point) => ({
        time: point.time,
        value: Math.round(point.value),
      })),
    });
  }
  return usage;
}

/**
 * Имя метрики приложения в statsd: как его считает скрипт-сборщик
 * (см. APP_METRICS_SCRIPT — правила должны совпадать)
 */
export function appMetricsGroupName(pm2Name: string): string {
  return pm2Name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Включает сбор метрик приложений: ставит Netdata (если его нет), обновляет
 * старый конфиг Plantar до облегчённого профиля (чужой конфиг не трогает),
 * кладёт скрипт-сборщик и запись cron, делает первый замер сразу.
 */
export async function enableAppMetrics(
  conn: SshConnection,
  log: (line: string) => void = () => {},
): Promise<void> {
  await installMonitoringTool(conn, "netdata", log);

  // Netdata, установленный прежней версией Plantar, переводим на облегчённый
  // профиль; конфиг, изменённый не Plantar, оставляем как есть
  const current = await conn.exec("cat /etc/netdata/netdata.conf 2>/dev/null");
  if (current.code === 0 && current.stdout.trim() === NETDATA_LEGACY_CONF.trim()) {
    await run(
      conn,
      `cat > /etc/netdata/netdata.conf <<'PLANTAR_EOF'\n${NETDATA_LEAN_CONF}\nPLANTAR_EOF`,
      () => {},
    );
    await run(conn, "systemctl restart netdata", log);
    await waitForNetdata(conn);
  }

  log(t("appMetricsInstalling"));
  const whoami = (await conn.exec("whoami")).stdout.trim();
  // pm2 и его pid-файлы принадлежат пользователю подключения — cron работает от него же
  const user = /^[a-z_][a-z0-9_-]*\$?$/.test(whoami) ? whoami : "root";
  await run(
    conn,
    `mkdir -p ${APP_METRICS_DIR} && ` +
      `cat > ${APP_METRICS_SCRIPT_PATH} <<'PLANTAR_EOF'\n${APP_METRICS_SCRIPT}\nPLANTAR_EOF\n` +
      `chmod 755 ${APP_METRICS_SCRIPT_PATH}`,
    () => {},
  );
  await run(
    conn,
    `cat > ${APP_METRICS_CRON_PATH} <<'PLANTAR_EOF'\n` +
      `* * * * * ${user} ${APP_METRICS_SCRIPT_PATH} >/dev/null 2>&1\nPLANTAR_EOF`,
    () => {},
  );
  // Первый замер сразу: точки памяти появляются мгновенно, CPU — со второго замера
  await run(conn, APP_METRICS_SCRIPT_PATH, () => {});
  log(t("appMetricsEnabled"));
}

/**
 * Обновляет установленный сборщик метрик до текущей версии: его поведение
 * меняется вместе с Plantar (например, обнуление датчиков остановленных
 * приложений), а кнопки переустановки в интерфейсе нет. Пока сбор метрик
 * приложений не включён — ничего не делает.
 */
export async function ensureAppMetricsScript(conn: SshConnection): Promise<void> {
  const cron = await conn.exec(`test -f ${APP_METRICS_CRON_PATH}`);
  if (cron.code !== 0) return;
  const installed = await conn.exec(`cat ${APP_METRICS_SCRIPT_PATH} 2>/dev/null`);
  if (installed.code === 0 && installed.stdout.trimEnd() === APP_METRICS_SCRIPT.trimEnd()) {
    return;
  }
  await run(
    conn,
    `cat > ${APP_METRICS_SCRIPT_PATH} <<'PLANTAR_EOF'\n${APP_METRICS_SCRIPT}\nPLANTAR_EOF\n` +
      `chmod 755 ${APP_METRICS_SCRIPT_PATH}`,
    () => {},
  );
}

/** История потребления приложения из Netdata */
export interface AppMetricsHistory {
  /** Загрузка процессора, % одного ядра (у многопроцессных может быть >100) */
  cpu: ServerMetricPoint[];
  /** Занятая память всего дерева процессов, МБ */
  memMb: ServerMetricPoint[];
}

/**
 * Группы (приложения) из id чартов сборщика метрик. Схема имён отличается
 * между версиями Netdata, поэтому разбор идёт по нормализованному id —
 * как в findAppMetricsChart. Чарты активности логов не считаются группами.
 */
export function appGroupsFromChartIds(chartIds: string[]): string[] {
  const groups = new Set<string>();
  for (const id of chartIds) {
    const normalized = id.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const match = normalized.match(/plantar_apps_(.+)_(?:cpu|mem)(?:_gauge)?$/);
    if (match) groups.add(match[1]);
  }
  return [...groups].sort();
}

/**
 * Ищет чарт метрики приложения среди чартов Netdata. Разные версии Netdata
 * по-разному строят id statsd-чартов (например, добавляют суффикс «_gauge»),
 * поэтому сравнение идёт по нормализованному имени метрики, а не по точному id.
 * Имя группы зажато между «plantar_apps_» и «_cpu/_mem» — ложные совпадения
 * с другими приложениями исключены.
 */
export function findAppMetricsChart(
  chartIds: string[],
  group: string,
  metric: AppMetricName,
): string | undefined {
  const wanted = `plantar_apps_${group}_${metric}`;
  return chartIds.find((id) => {
    const normalized = id.toLowerCase().replace(/[^a-z0-9]/g, "_");
    return normalized.endsWith(wanted) || normalized.includes(`${wanted}_`);
  });
}

/** id всех чартов Netdata; ошибка — служба не отвечает */
async function fetchNetdataChartIds(conn: SshConnection): Promise<string[]> {
  const charts = await conn.exec(`curl -sf --max-time 10 '${NETDATA_API}/charts'`);
  if (charts.code !== 0) throw new Error(t("netdataNotResponding"));
  try {
    return Object.keys(
      (JSON.parse(charts.stdout) as { charts?: Record<string, unknown> }).charts ?? {},
    );
  } catch {
    throw new Error(t("netdataNotResponding"));
  }
}

/** Укрупняет ряд в корзины по bucketSeconds, усредняя значения корзины */
export function downsampleAverage(
  points: ServerMetricPoint[],
  bucketSeconds: number,
): ServerMetricPoint[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const point of points) {
    const bucket = Math.floor(point.time / bucketSeconds) * bucketSeconds;
    const entry = buckets.get(bucket) ?? { sum: 0, count: 0 };
    entry.sum += point.value;
    entry.count += 1;
    buckets.set(bucket, entry);
  }
  return [...buckets.entries()]
    .map(([time, { sum, count }]) => ({ time, value: sum / count }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Ряд метрики приложения (единственная размерность gauge). Пустой ряд —
 * не ошибка: чарт ещё не появился или точки не накопились.
 *
 * Крупные корзины Netdata отдаёт из грубых ярусов хранения, которые у
 * свежего чарта пустуют часами, — поэтому запрашиваются мелкие корзины
 * (30 секунд, ярус 0), а укрупнение до нужного числа точек делается здесь.
 */
async function queryAppMetric(
  conn: SshConnection,
  chartIds: string[],
  group: string,
  metric: AppMetricName,
  seconds: number,
  points: number,
): Promise<ServerMetricPoint[]> {
  const chart = findAppMetricsChart(chartIds, group, metric);
  if (!chart) return [];
  const fine = Math.max(points, Math.min(2880, Math.round(seconds / 30)));
  const result = await conn.exec(
    `curl -sf --max-time 10 '${NETDATA_API}/data?chart=${chart}` +
      `&after=-${Math.round(seconds)}&points=${fine}&group=average&format=json'`,
  );
  if (result.code !== 0) return [];
  let raw: NetdataData;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const rows = netdataRows(raw).map((row) => ({ time: row[0], value: row[1] }));
  return fine > points ? downsampleAverage(rows, seconds / points) : rows;
}

/**
 * История потребления приложения за последние `seconds` секунд. Пустые ряды —
 * не ошибка: сборщик включён недавно и точки ещё не накопились.
 */
export async function getAppMetricsHistory(
  conn: SshConnection,
  pm2Name: string,
  seconds: number,
): Promise<AppMetricsHistory> {
  const group = appMetricsGroupName(pm2Name);
  const chartIds = await fetchNetdataChartIds(conn);
  // CPU — с десятыми, память — целые МБ
  const cpu = (await queryAppMetric(conn, chartIds, group, "cpu", seconds, 120)).map(
    (point) => ({ time: point.time, value: Math.round(point.value * 10) / 10 }),
  );
  const memMb = (await queryAppMetric(conn, chartIds, group, "mem", seconds, 120)).map(
    (point) => ({ time: point.time, value: Math.round(point.value) }),
  );
  return { cpu, memMb };
}

/** Точка активности логов приложения */
export interface AppLogPoint {
  /** unix-секунды начала интервала */
  time: number;
  /** Строк обычного вывода за час */
  out: number;
  /** Строк в потоке ошибок за час */
  err: number;
}

/**
 * Активность логов приложения за последние сутки, по часам. Сборщик шлёт
 * количество строк за минуту; среднее за час, умноженное на 60, даёт строки
 * в час. Пустой массив — не ошибка: точки ещё не накопились.
 */
export async function getAppLogActivity(
  conn: SshConnection,
  pm2Name: string,
): Promise<AppLogPoint[]> {
  const group = appMetricsGroupName(pm2Name);
  const chartIds = await fetchNetdataChartIds(conn);
  const perHour = (points: ServerMetricPoint[]) =>
    points.map((point) => ({ time: point.time, value: Math.round(point.value * 60) }));
  const out = perHour(await queryAppMetric(conn, chartIds, group, "out_lines", 86400, 24));
  const err = perHour(await queryAppMetric(conn, chartIds, group, "err_lines", 86400, 24));

  // Ряды объединяются по времени: у часа может быть только один из потоков
  const byTime = new Map<number, AppLogPoint>();
  for (const point of out) {
    byTime.set(point.time, { time: point.time, out: point.value, err: 0 });
  }
  for (const point of err) {
    const existing = byTime.get(point.time);
    if (existing) existing.err = point.value;
    else byTime.set(point.time, { time: point.time, out: 0, err: point.value });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
