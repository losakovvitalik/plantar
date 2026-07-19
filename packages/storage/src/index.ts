import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Language, systemLanguage } from "@plantar/i18n";

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

/** Приложение, обнаруженное на сервере при импорте: как управлять им до первого деплоя */
export interface ExternalAppInfo {
  /** Имя pm2-процесса на сервере; может отличаться от имени проекта */
  pm2Name: string;
  /** Папка приложения на сервере */
  appDir: string;
  /** Прежний конфиг nginx; отключается при первом деплое через Plantar */
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
  /** Для source=git: коммит последнего успешного деплоя */
  deployedCommit?: DeployedCommit;
  /** Импортирован с сервера: Plantar управляет приложением, но структура версий
   *  появится после первого деплоя; до этого возврат версии недоступен.
   *  Сбрасывается после первого успешного деплоя через Plantar. */
  external?: ExternalAppInfo;
}

function readJsonList<T>(file: string): T[] {
  const full = path.join(dataDir(), file);
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, "utf8")) as T[];
}

function writeJsonList<T>(file: string, list: T[]): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), file), JSON.stringify(list, null, 2));
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
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, "utf8")) as object) };
}

export function writeSettings(settings: AppSettings): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), "settings.json"), JSON.stringify(settings, null, 2));
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
  /** Запись создана возвратом предыдущей версии; отсутствует — обычный деплой */
  kind?: "deploy" | "rollback";
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
  if (!existsSync(historyFile())) return [];
  // Битый history.json не должен ломать вкладки — деградируем до пустой истории
  try {
    return JSON.parse(readFileSync(historyFile(), "utf8")) as DeployRecord[];
  } catch {
    return [];
  }
}

export function appendHistory(record: DeployRecord): void {
  mkdirSync(dataDir(), { recursive: true });
  const history = readHistory();
  history.push(record);
  writeFileSync(historyFile(), JSON.stringify(history, null, 2));
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
  const file = commitsCacheFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, CommitsCacheEntry>;
}

export function writeCommitsCache(cache: Record<string, CommitsCacheEntry>): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(commitsCacheFile(), JSON.stringify(cache, null, 2));
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
  const file = appStatusCacheFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, AppStatusEntry>;
}

export function writeAppStatusCache(cache: Record<string, AppStatusEntry>): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(appStatusCacheFile(), JSON.stringify(cache, null, 2));
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
  const file = statusTabCacheFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, StatusTabCacheEntry>;
}

export function writeStatusTabCache(cache: Record<string, StatusTabCacheEntry>): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(statusTabCacheFile(), JSON.stringify(cache, null, 2));
}
