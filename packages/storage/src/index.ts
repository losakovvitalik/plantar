import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Language, systemLanguage } from "@plantar/i18n";
import { deployLogTimestamp } from "./last-run";

export type { Language } from "@plantar/i18n";
export { type LastDeployRun, deployLogTimestamp, resolveLastRun } from "./last-run";

/** Директория данных Plantar по конвенциям ОС */
export function dataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "plantar");
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
        "plantar",
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
        "plantar",
      );
  }
}

function logsDir(project: string): string {
  const dir = path.join(dataDir(), "logs", project);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Пишет лог деплоя в файл по мере выполнения */
export class DeployLogWriter {
  readonly file: string;

  constructor(project: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = path.join(logsDir(project), `deploy-${timestamp}.log`);
    writeFileSync(this.file, "");
  }

  write(line: string): void {
    appendFileSync(this.file, line + "\n");
  }
}

/** Файлы deploy-логов проекта (полные пути), от старых к новым */
export function listDeployLogs(project: string): string[] {
  const dir = path.join(dataDir(), "logs", project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^deploy-.*\.log$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Хвост файла лога, не длиннее maxBytes: логи не ограничены по размеру,
 * и целиком их читать нельзя. Оборванная первая строка отбрасывается.
 */
export function readLogTail(file: string, maxBytes = 512_000): string {
  const size = statSync(file).size;
  if (size <= maxBytes) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    const text = buf.toString("utf8");
    const firstNewline = text.indexOf("\n");
    return firstNewline === -1 ? text : text.slice(firstNewline + 1);
  } finally {
    closeSync(fd);
  }
}

/** Сохраняет последний скачанный серверный лог; возвращает путь к файлу */
export function saveServerLogSnapshot(
  project: string,
  kind: "access" | "error",
  content: string,
): string {
  const file = path.join(logsDir(project), `nginx-${kind}.log`);
  writeFileSync(file, content);
  return file;
}

export interface ServerRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  /** password-серверы не хранят секрет — пароль запрашивается при каждом подключении */
  auth: "key" | "password";
  keyPath?: string;
}

/** Коммит, задеплоенный в последний раз (для git-проектов) */
export interface DeployedCommit {
  hash: string;
  message: string;
}

/** Приложение, обнаруженное на сервере при импорте: где оно живёт и как им управлять */
export interface ExternalAppInfo {
  /** Имя pm2-процесса на сервере; может отличаться от имени проекта */
  pm2Name: string;
  /** Папка приложения на сервере — бережный деплой обновляет код прямо в ней */
  appDir: string;
  /** Прежний конфиг nginx; отключается при переносе под управление Plantar */
  nginxConfFile?: string;
  /** Пути логов pm2-процесса — у чужих процессов бывают нестандартными */
  outLogPath?: string;
  errLogPath?: string;
  /** Пути логов nginx из прежнего конфига */
  accessLogPath?: string;
  errorLogPath?: string;
  /** Git-репозиторий, из которого приложение попало на сервер (https-адрес);
   *  позволяет подключить проект к GitHub вместо выбора локальной папки */
  repoUrl?: string;
  branch?: string;
  /** Папка приложения внутри репозитория; пусто — корень */
  repoSubdir?: string;
  /** Настройки проекта, пока не привязана папка с кодом и нет plantar.json */
  config: {
    name: string;
    type: "static" | "node" | "next" | "bot";
    runtime?: "node" | "python";
    domain?: string;
    port?: number;
  };
}

export interface ProjectRecord {
  id: string;
  serverId: string;
  /** name из plantar.json на момент добавления */
  name: string;
  /** Локальная папка проекта; для git-источника — путь к клону в reposDir();
   *  у импортированного с сервера проекта пусто, пока папка не привязана */
  path: string;
  /** Подпапка внутри path, где лежит проект (для монорепозиториев); пусто — корень */
  subdir?: string;
  /** Источник кода; отсутствует у старых записей — считается "local" */
  source?: "local" | "git";
  /** Для source=git: ссылка на репозиторий и выбранная ветка */
  repoUrl?: string;
  branch?: string;
  /** Коммит последнего успешного деплоя: для source=git — из локального клона,
   *  для внешнего проекта — из репозитория приложения на сервере */
  deployedCommit?: DeployedCommit;
  /** Импортирован с сервера и живёт в бережном режиме: деплой обновляет код
   *  в исходной папке приложения, версии — по git-истории на сервере.
   *  Пометка снимается только при явном переносе под управление Plantar. */
  external?: ExternalAppInfo;
}

/**
 * Reads a JSON store, degrading to a fallback when the file is missing or
 * corrupted: a broken store must never crash startup. The corrupted file is
 * kept as <file>.broken (first occurrence only) so data can be recovered.
 */
function readJsonSafe<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.error(`plantar: corrupted JSON store ${file}, falling back to defaults`, err);
    const backup = `${file}.broken`;
    try {
      if (!existsSync(backup)) copyFileSync(file, backup);
    } catch {
      // best effort — recovering the backup must not introduce a new crash
    }
    return fallback;
  }
}

/**
 * Writes a JSON store atomically: temp file in the same directory + rename,
 * so a crash mid-write leaves either the old or the new content on disk.
 * The temp file is fsynced before the rename — otherwise the filesystem may
 * journal the rename ahead of the data blocks and power loss would still
 * leave a truncated target.
 */
function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(data, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function readJsonList<T>(file: string): T[] {
  const list = readJsonSafe<T[]>(path.join(dataDir(), file), []);
  // Valid JSON of the wrong shape (e.g. a hand-edited `null`) must not
  // push the crash into the caller's first .map
  return Array.isArray(list) ? list : [];
}

function writeJsonList<T>(file: string, list: T[]): void {
  writeJsonAtomic(path.join(dataDir(), file), list);
}

export interface AppSettings {
  /** Сохранять локальные копии серверных логов при каждом просмотре */
  saveServerLogCopies: boolean;
  /** Email для Let's Encrypt (уведомления о проблемах с сертификатами); пусто — без email */
  letsEncryptEmail: string;
  /** Показывать системное уведомление об успешном деплое (об ошибке — всегда) */
  notifyOnDeploySuccess: boolean;
  /** Фоновая проверка приложений с уведомлениями о падениях и восстановлениях */
  notifyOnAppDown: boolean;
  /** Язык интерфейса */
  language: Language;
}

const DEFAULT_SETTINGS: AppSettings = {
  saveServerLogCopies: true,
  letsEncryptEmail: "",
  notifyOnDeploySuccess: true,
  notifyOnAppDown: true,
  language: systemLanguage(),
};

export function readSettings(): AppSettings {
  const file = path.join(dataDir(), "settings.json");
  return { ...DEFAULT_SETTINGS, ...readJsonSafe<Partial<AppSettings>>(file, {}) };
}

export function writeSettings(settings: AppSettings): void {
  writeJsonAtomic(path.join(dataDir(), "settings.json"), settings);
}

export const readServers = () => readJsonList<ServerRecord>("servers.json");
export const writeServers = (list: ServerRecord[]) => writeJsonList("servers.json", list);
export const readProjects = () => readJsonList<ProjectRecord>("projects.json");
export const writeProjects = (list: ProjectRecord[]) => writeJsonList("projects.json", list);

/** Директория для SSH-ключей, которые Plantar создаёт сам */
export function keysDir(): string {
  const dir = path.join(dataDir(), "keys");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Директория для локальных клонов git-репозиториев проектов */
export function reposDir(): string {
  const dir = path.join(dataDir(), "repos");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface DeployRecord {
  project: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "error";
  /** Запись создана возвратом предыдущей версии; отсутствует — обычный деплой.
   *  migrate — the run moved an external project under Plantar management */
  kind?: "deploy" | "rollback" | "migrate";
  url?: string;
  error?: string;
  /** Машинный код ошибки (например npm-peer-conflict) — по нему GUI
   *  предлагает действие; у старых записей отсутствует */
  code?: string;
  /** Хеш задеплоенного коммита (для git-проектов); свяжет деплой с коммитом */
  commit?: string;
  logFile: string;
}

function historyFile(): string {
  return path.join(dataDir(), "history.json");
}

export function readHistory(): DeployRecord[] {
  const history = readJsonSafe<DeployRecord[]>(historyFile(), []);
  // Same wrong-shape guard as readJsonList — appendHistory pushes into this
  return Array.isArray(history) ? history : [];
}

/** How many deploy records are kept per project on a host; older ones are evicted */
const HISTORY_LIMIT_PER_PROJECT = 200;

/**
 * Drops the oldest records of every project beyond the limit, keeping the
 * original order. The cap is per project + host, because that is how history is
 * read back everywhere: a global cap would let one busy project flush out the
 * records of a rarely deployed one, and a project whose newest record is gone
 * while its deploy log is still on disk reads back as an interrupted deploy.
 */
function capHistory(history: DeployRecord[]): DeployRecord[] {
  const kept = new Map<string, number>();
  const result: DeployRecord[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    const key = `${record.project} ${record.host}`;
    const count = kept.get(key) ?? 0;
    if (count >= HISTORY_LIMIT_PER_PROJECT) continue;
    kept.set(key, count + 1);
    result.push(record);
  }
  return result.reverse();
}

/** Log directory of a project, or null when the name escapes <dataDir>/logs */
function safeLogDir(project: string): string | null {
  const root = path.join(dataDir(), "logs") + path.sep;
  const dir = path.resolve(path.join(dataDir(), "logs", project));
  return dir.startsWith(root) ? dir : null;
}

/**
 * Deletes the run files of records the cap has evicted: they are unreachable
 * from the UI (a log is only opened through the logFile of a record), while a
 * single build log easily takes hundreds of kilobytes.
 *
 * Matching is strict on deploy-*.log, so the nginx snapshots living in the same
 * directory survive. A file newer than the project's newest record is kept:
 * resolveLastRun reads it as an interrupted run after a restart, and it is also
 * the file of a deploy still in flight (from the CLI, say) whose record does not
 * exist yet. Records of every host are taken into account — the cap is per
 * project + host, but a project deployed to two servers shares one directory.
 */
function pruneDeployLogs(project: string, history: DeployRecord[]): void {
  const records = history.filter((r) => r.project === project);
  if (records.length === 0) return;
  const kept = new Set(records.map((r) => path.basename(r.logFile)));
  const newest = records.reduce(
    (max, r) => (r.startedAt > max ? r.startedAt : max),
    records[0].startedAt,
  );
  const dir = safeLogDir(project);
  if (dir === null || !existsSync(dir)) return;
  try {
    for (const name of readdirSync(dir)) {
      if (!/^deploy-.*\.log$/.test(name) || kept.has(name)) continue;
      const time = deployLogTimestamp(name);
      if (time === null || time > newest) continue;
      try {
        rmSync(path.join(dir, name));
      } catch {
        // best effort — a locked file must not fail the deploy
      }
    }
  } catch {
    // best effort — an unreadable directory must not fail the deploy
  }
}

/** Deletes all logs of a project — for when the project itself is removed */
export function removeProjectLogs(project: string): void {
  const dir = safeLogDir(project);
  if (dir === null) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort — a locked file must not fail removing the project
  }
}

/**
 * The whole file is rewritten on every deploy, so the log is capped instead of
 * growing forever. Read-modify-write cannot interleave inside one process (the
 * call is fully synchronous); a deploy from the CLI running at the same time as
 * one from the app can still lose a record — accepted, the file is a log.
 */
export function appendHistory(record: DeployRecord): void {
  const history = readHistory();
  history.push(record);
  const capped = capHistory(history);
  writeJsonAtomic(historyFile(), capped);
  pruneDeployLogs(record.project, capped);
}

/** Коммит в кэше вкладки «Коммиты» (совпадает по форме с Commit из main/git.ts) */
export interface CachedCommit {
  hash: string;
  subject: string;
  date: string;
  author: string;
}

/** Снимок вкладки «Коммиты» одного проекта: список коммитов + статусы деплоев */
export interface CommitsCacheEntry {
  commits: CachedCommit[];
  history: DeployRecord[];
  cachedAt: string;
}

function commitsCacheFile(): string {
  return path.join(dataDir(), "commits-cache.json");
}

/** Кэш вкладки «Коммиты» по projectId — для мгновенного показа при открытии */
export function readCommitsCache(): Record<string, CommitsCacheEntry> {
  return readJsonSafe<Record<string, CommitsCacheEntry>>(commitsCacheFile(), {});
}

export function writeCommitsCache(cache: Record<string, CommitsCacheEntry>): void {
  writeJsonAtomic(commitsCacheFile(), cache);
}

/** Статус приложения на сервере: pm2-процесс + HTTP-проверка сайта.
 *  unresponsive — процесс/статика на месте, но сайт не отвечает;
 *  static — статичный сайт, который ещё не проверялся (не был задеплоен) */
export type AppStatus = "running" | "stopped" | "error" | "unresponsive" | "static";

/** Снимок статусов приложений одного сервера */
export interface AppStatusEntry {
  /** projectId → статус */
  apps: Record<string, AppStatus>;
  checkedAt: string;
}

function appStatusCacheFile(): string {
  return path.join(dataDir(), "app-status-cache.json");
}

/** Кэш статусов приложений по serverId — для мгновенного показа при открытии */
export function readAppStatusCache(): Record<string, AppStatusEntry> {
  return readJsonSafe<Record<string, AppStatusEntry>>(appStatusCacheFile(), {});
}

export function writeAppStatusCache(cache: Record<string, AppStatusEntry>): void {
  writeJsonAtomic(appStatusCacheFile(), cache);
}

/** Кэш вкладки «Статус» одного проекта; форму полей задаёт вкладка (desktop),
 *  хранилище их не интерпретирует. Поля пишутся независимо — каждая карточка
 *  сохраняет своё по мере загрузки */
export interface StatusTabCacheEntry {
  snapshot?: unknown;
  metricsHistory?: unknown;
  logActivity?: unknown;
  cachedAt: string;
}

function statusTabCacheFile(): string {
  return path.join(dataDir(), "status-tab-cache.json");
}

/** Кэш вкладки «Статус» по projectId — для мгновенного показа при открытии */
export function readStatusTabCache(): Record<string, StatusTabCacheEntry> {
  return readJsonSafe<Record<string, StatusTabCacheEntry>>(statusTabCacheFile(), {});
}

export function writeStatusTabCache(cache: Record<string, StatusTabCacheEntry>): void {
  writeJsonAtomic(statusTabCacheFile(), cache);
}
