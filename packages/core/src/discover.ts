import { type SshConnection, shellQuote } from "@plantar/ssh";

/**
 * Обнаружение приложений, запущенных на сервере до подключения Plantar.
 * Ничего не устанавливает: читает pm2 jlist, nginx -T и ss -tlnp.
 */

/** Имена env-файлов: .env, .env.local, .env.prod и т.п. */
export const ENV_FILE_RE = /^\.env[\w.-]*$/;

/** Шаблоны без реальных значений и скрипты direnv — при импорте не переносим */
const ENV_SKIP_RE = /\.(example|sample|template)$|^\.envrc$/i;

/** Порядок переопределения как у dotenv: базовый .env, затем остальные, *.local — последними */
function envFileRank(name: string): number {
  if (name === ".env") return 0;
  return name.includes(".local") ? 2 : 1;
}

/** Env-файлы в папке приложения, отсортированные от базового к переопределяющему */
export async function listAppEnvFiles(
  conn: SshConnection,
  appDir: string,
): Promise<string[]> {
  if (!appDir) return [];
  const result = await conn.exec(`ls -a ${shellQuote(appDir)} 2>/dev/null`);
  if (result.code !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => ENV_FILE_RE.test(name) && !ENV_SKIP_RE.test(name))
    .sort((a, b) => envFileRank(a) - envFileRank(b) || a.localeCompare(b));
}

/**
 * Содержимое env-файлов приложения одним текстом. При нескольких файлах блоки
 * идут от базового к переопределяющему (при деплое поздние значения побеждают)
 * и помечаются комментарием с именем исходного файла.
 */
export async function readAppEnv(conn: SshConnection, appDir: string): Promise<string> {
  const files = await listAppEnvFiles(conn, appDir);
  const parts: string[] = [];
  for (const file of files) {
    const result = await conn.exec(`cat ${shellQuote(`${appDir}/${file}`)} 2>/dev/null`);
    if (result.code !== 0) continue;
    const content = result.stdout.trim();
    if (!content) continue;
    parts.push(files.length > 1 ? `# ${file}\n${content}` : content);
  }
  return parts.join("\n\n");
}

/** pm2-процесс из pm2 jlist — только поля, нужные для импорта */
export interface Pm2App {
  name: string;
  pid?: number;
  status: string;
  cwd: string;
  script: string;
  interpreter?: string;
  /** PORT из окружения процесса, если задан */
  envPort?: number;
  outLogPath?: string;
  errLogPath?: string;
}

interface RawPm2Process {
  pid?: number;
  name?: string;
  pm2_env?: {
    status?: string;
    pm_cwd?: string;
    pm_exec_path?: string;
    exec_interpreter?: string;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
    pmx_module?: boolean;
    env?: Record<string, unknown>;
  };
}

/** JSON-массив из вывода pm2 jlist; pm2 может напечатать служебные строки до JSON */
export function extractPm2Json(stdout: string): unknown[] {
  // Service lines like "[PM2] Spawning PM2 daemon..." also start with "[",
  // so look for a line that actually starts the JSON array: "[{" or "[]"
  const match = /^\[\s*[{\]]/m.exec(stdout);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.slice(match.index));
  } catch {
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

export function parsePm2Jlist(stdout: string): Pm2App[] {
  return (extractPm2Json(stdout) as RawPm2Process[]).flatMap((proc) => {
    const env = proc.pm2_env ?? {};
    if (!proc.name) return [];
    // Модули pm2 (pm2-logrotate и т.п.) — служебные, не приложения пользователя
    if (env.pmx_module || (env.pm_exec_path ?? "").includes("/.pm2/modules/")) return [];
    const envPort = Number(env.env?.PORT);
    return [
      {
        name: proc.name,
        pid: proc.pid || undefined,
        status: env.status ?? "unknown",
        cwd: env.pm_cwd ?? "",
        script: env.pm_exec_path ?? "",
        interpreter: env.exec_interpreter,
        envPort: Number.isInteger(envPort) && envPort > 0 ? envPort : undefined,
        outLogPath: env.pm_out_log_path,
        errLogPath: env.pm_err_log_path,
      },
    ];
  });
}

/** Слушающие порты по pid процесса (вывод ss -tlnpH) */
export function parseListeningPorts(stdout: string): Map<number, number[]> {
  const byPid = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    // Колонки: State Recv-Q Send-Q Local:Port Peer:Port Process
    const portMatch = (cols[3] ?? "").match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    for (const pidMatch of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(pidMatch[1]);
      const ports = byPid.get(pid) ?? [];
      if (!ports.includes(port)) ports.push(port);
      byPid.set(pid, ports);
    }
  }
  return byPid;
}

/** pid → ppid из вывода `ps -eo pid=,ppid=` */
export function parsePpidMap(stdout: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (match) map.set(Number(match[1]), Number(match[2]));
  }
  return map;
}

/**
 * Порты, которые слушает процесс или его потомки: pm2 часто запускает
 * обёртку (npm start), а сокет открывает дочерний node-процесс.
 */
export function portsOwnedBy(
  appPid: number,
  portsByPid: Map<number, number[]>,
  parentOf: Map<number, number>,
): number[] {
  const ports: number[] = [];
  for (const [pid, pidPorts] of portsByPid) {
    let current: number | undefined = pid;
    for (let depth = 0; current !== undefined && depth < 10; depth++) {
      if (current === appPid) {
        ports.push(...pidPorts);
        break;
      }
      current = parentOf.get(current);
    }
  }
  return ports;
}

/** server-блок из дампа nginx -T */
export interface NginxSite {
  /** Файл конфига, в котором описан блок */
  file: string;
  serverNames: string[];
  /** Локальные порты, на которые блок проксирует запросы */
  proxyPorts: number[];
  root?: string;
  accessLog?: string;
  errorLog?: string;
}

/**
 * Вырезает блоки вида `<keyword> … { … }` с учётом вложенных скобок.
 * Комментарии срезаются заранее — скобки в них ломали бы подсчёт.
 */
function extractBlocks(text: string, keyword: string): Array<{ header: string; body: string }> {
  const clean = text
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
  const blocks: Array<{ header: string; body: string }> = [];
  const re = new RegExp(`(?:^|[\\s;}])(${keyword}\\b[^{;]*)\\{`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      i++;
    }
    blocks.push({ header: match[1].trim(), body: clean.slice(start, i - 1) });
    re.lastIndex = i;
  }
  return blocks;
}

const LOCAL_HOST_RE = "(?:127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0)";

/** Разбирает дамп `nginx -T`: server-блоки с доменами и портами проксирования */
export function parseNginxSites(dump: string): NginxSite[] {
  // nginx -T перед содержимым каждого файла печатает маркер с его путём
  const files: Array<{ file: string; text: string }> = [];
  let current: { file: string; text: string } | null = null;
  for (const line of dump.split("\n")) {
    const marker = line.match(/^# configuration file (.+):\s*$/);
    if (marker) {
      current = { file: marker[1], text: "" };
      files.push(current);
    } else if (current) {
      current.text += line + "\n";
    }
  }
  if (files.length === 0) files.push({ file: "", text: dump });

  // upstream может объявляться в одном файле, а использоваться в другом
  const upstreamPorts = new Map<string, number[]>();
  for (const { text } of files) {
    for (const block of extractBlocks(text, "upstream")) {
      const name = block.header.split(/\s+/)[1];
      if (!name) continue;
      const ports = [
        ...block.body.matchAll(new RegExp(`(?:^|\\s)server\\s+${LOCAL_HOST_RE}:(\\d+)`, "g")),
      ].map((m) => Number(m[1]));
      if (ports.length > 0) upstreamPorts.set(name, ports);
    }
  }

  const sites: NginxSite[] = [];
  for (const { file, text } of files) {
    for (const block of extractBlocks(text, "server")) {
      const body = block.body;
      const serverNames = [...body.matchAll(/(?:^|\s)server_name\s+([^;]+);/g)].flatMap((m) =>
        m[1].trim().split(/\s+/),
      );
      const proxyPorts: number[] = [];
      for (const m of body.matchAll(/(?:^|\s)proxy_pass\s+(https?:\/\/[^;\s]+)/g)) {
        const direct = m[1].match(new RegExp(`^https?://${LOCAL_HOST_RE}:(\\d+)`));
        if (direct) {
          proxyPorts.push(Number(direct[1]));
          continue;
        }
        const upstream = m[1].match(/^https?:\/\/([^/:]+)/);
        if (upstream) proxyPorts.push(...(upstreamPorts.get(upstream[1]) ?? []));
      }
      if (serverNames.length === 0 && proxyPorts.length === 0) continue;
      sites.push({
        file,
        serverNames: [...new Set(serverNames)],
        proxyPorts: [...new Set(proxyPorts)],
        root: body.match(/(?:^|\s)root\s+([^;]+);/)?.[1].trim(),
        accessLog: body.match(/(?:^|\s)access_log\s+([^;\s]+)/)?.[1],
        errorLog: body.match(/(?:^|\s)error_log\s+([^;\s]+)/)?.[1],
      });
    }
  }
  return sites;
}

/**
 * server-блоки чужих конфигов, объявляющие тот же домен в server_name.
 * Совпадение только точное: catch-all («_», «*.домен») конфликтом не считается.
 * Собственные пути Plantar (sites-available|enabled/<имя>.conf) исключаются.
 */
export function findDomainConflicts(
  sites: NginxSite[],
  domain: string,
  projectName: string,
): NginxSite[] {
  const ownFiles = new Set([
    `/etc/nginx/sites-available/${projectName}.conf`,
    `/etc/nginx/sites-enabled/${projectName}.conf`,
  ]);
  return sites.filter(
    (site) => !ownFiles.has(site.file) && site.serverNames.includes(domain),
  );
}

/**
 * Приводит адрес git-remote к https-виду, с которым работает Plantar
 * (клонирование с токеном идёт по https): git@host:owner/repo(.git) и
 * ssh://git@host/owner/repo → https://host/owner/repo.
 */
export function normalizeGitUrl(raw: string): string | undefined {
  const url = raw.trim().replace(/\.git$/, "");
  if (!url) return undefined;
  const scp = url.match(/^git@([^:/]+):(.+)$/);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = url.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  if (url.startsWith("https://")) return url;
  return undefined;
}

/** Git-репозиторий, из которого приложение попало на сервер */
interface AppRepoInfo {
  repoUrl: string;
  /** Текущая ветка; отсутствует, если HEAD отвязан от ветки */
  branch?: string;
  /** Папка приложения относительно корня репозитория; "" — корень */
  repoSubdir: string;
}

/** Читает git-информацию папки приложения на сервере; null — не git-репозиторий */
async function detectAppRepo(
  conn: SshConnection,
  appDir: string,
): Promise<AppRepoInfo | null> {
  if (!appDir) return null;
  const dir = shellQuote(appDir);
  const result = await conn.exec(
    `git -C ${dir} rev-parse --show-toplevel 2>/dev/null; echo ---; ` +
      `git -C ${dir} rev-parse --abbrev-ref HEAD 2>/dev/null; echo ---; ` +
      `git -C ${dir} config --get remote.origin.url 2>/dev/null`,
  );
  const [toplevel = "", branch = "", origin = ""] = result.stdout
    .split("---")
    .map((part) => part.trim());
  if (!toplevel || !origin) return null;
  const repoUrl = normalizeGitUrl(origin);
  if (!repoUrl) return null;
  const repoSubdir =
    appDir === toplevel ? "" : appDir.startsWith(toplevel + "/")
      ? appDir.slice(toplevel.length + 1)
      : "";
  return {
    repoUrl,
    // «HEAD» означает отвязанное состояние — ветку выберем при подключении
    branch: branch && branch !== "HEAD" ? branch : undefined,
    repoSubdir,
  };
}

/** Приложение, найденное на сервере, с предзаполнением полей для импорта */
export interface DiscoveredApp {
  /** Имя процесса в pm2 */
  pm2Name: string;
  /** Статус процесса: online, stopped, errored, … */
  status: string;
  /** Папка приложения на сервере */
  appDir: string;
  /** Файл, который запускает процесс */
  script: string;
  /** Порт, на котором приложение принимает запросы */
  port?: number;
  /** Домен из конфига nginx, проксирующего на порт приложения */
  domain?: string;
  /** Конфиг nginx, обслуживающий приложение */
  nginxConfFile?: string;
  /** Пути логов pm2-процесса */
  outLogPath?: string;
  errLogPath?: string;
  /** Пути логов nginx из конфига сайта */
  accessLogPath?: string;
  errorLogPath?: string;
  /** Env-файлы в папке приложения — при импорте их содержимое переносится в Plantar */
  envFiles: string[];
  /** Git-репозиторий, из которого приложение попало на сервер (адрес в https-виде) */
  repoUrl?: string;
  /** Ветка, развёрнутая на сервере */
  branch?: string;
  /** Папка приложения внутри репозитория; "" — корень */
  repoSubdir?: string;
  /** Имя проекта, приведённое к допустимому формату */
  suggestedName: string;
  suggestedType: "node" | "next" | "bot";
  runtime: "node" | "python";
}

/** Приводит имя pm2-процесса к формату имени проекта Plantar */
function suggestName(pm2Name: string): string {
  const name = pm2Name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "app";
}

/**
 * Находит приложения, запущенные на сервере: pm2-процессы, их порты (env PORT
 * и слушающие сокеты) и домены из nginx. Ничего не ставит и не меняет на сервере.
 */
export async function discoverApps(conn: SshConnection): Promise<DiscoveredApp[]> {
  const jlist = await conn.exec("pm2 jlist 2>/dev/null");
  if (jlist.code !== 0) return [];
  const procs = parsePm2Jlist(jlist.stdout);
  if (procs.length === 0) return [];

  const listening = await conn.exec("ss -tlnpH 2>/dev/null");
  const portsByPid = parseListeningPorts(listening.stdout);
  const processTree = await conn.exec("ps -eo pid=,ppid= 2>/dev/null");
  const parentOf = parsePpidMap(processTree.stdout);

  const nginxDump = await conn.exec("nginx -T 2>/dev/null");
  const sites = nginxDump.code === 0 ? parseNginxSites(nginxDump.stdout) : [];

  const apps: DiscoveredApp[] = [];
  for (const proc of procs) {
    const ports = [
      ...new Set([
        proc.envPort,
        ...(proc.pid ? portsOwnedBy(proc.pid, portsByPid, parentOf) : []),
      ]),
    ].filter((p): p is number => p !== undefined);

    const site = sites.find((s) => s.proxyPorts.some((p) => ports.includes(p)));
    const domain = site?.serverNames.find((n) => n && n !== "_");
    const port = site?.proxyPorts.find((p) => ports.includes(p)) ?? ports[0];

    const python =
      (proc.interpreter ?? "").includes("python") || proc.script.endsWith(".py");
    let suggestedType: DiscoveredApp["suggestedType"];
    if (python) {
      suggestedType = "bot";
    } else if (proc.cwd && (await conn.exec(`test -d ${shellQuote(`${proc.cwd}/.next`)}`)).code === 0) {
      suggestedType = "next";
    } else if (port !== undefined) {
      suggestedType = "node";
    } else {
      suggestedType = "bot";
    }

    const repo = await detectAppRepo(conn, proc.cwd);

    apps.push({
      pm2Name: proc.name,
      status: proc.status,
      appDir: proc.cwd,
      script: proc.script,
      port,
      domain,
      nginxConfFile: site?.file,
      outLogPath: proc.outLogPath,
      errLogPath: proc.errLogPath,
      accessLogPath: site?.accessLog,
      errorLogPath: site?.errorLog,
      envFiles: await listAppEnvFiles(conn, proc.cwd),
      repoUrl: repo?.repoUrl,
      branch: repo?.branch,
      repoSubdir: repo?.repoSubdir,
      suggestedName: suggestName(proc.name),
      suggestedType,
      runtime: python ? "python" : "node",
    });
  }
  return apps;
}
