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
import { byLogName, deployLogTimestamp } from "./last-run";

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

/**
 * Файлы deploy-логов проекта (полные пути), от старых к новым.
 * The directory is keyed by the project name as of the deploy, so a renamed
 * project has one directory per name it deployed under — pass all of them to
 * keep the runs from before the rename reachable.
 */
export function listDeployLogs(projectNames: string[]): string[] {
  const files: string[] = [];
  for (const name of new Set(projectNames)) {
    const dir = path.join(dataDir(), "logs", name);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (/^deploy-.*\.log$/.test(file)) files.push(path.join(dir, file));
    }
  }
  // The same order resolveLastRun uses: by the ISO timestamp in the file name
  return files.sort(byLogName);
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
  /** The names the project deployed under before its renames; its earlier
   *  history records and log directories are found by them */
  previousNames?: string[];
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

/** Keeps the unusable file as <file>.broken, the first occurrence only */
function keepBrokenCopy(file: string): void {
  const backup = `${file}.broken`;
  try {
    if (!existsSync(backup)) copyFileSync(file, backup);
  } catch {
    // best effort — recovering the backup must not introduce a new crash
  }
}

/**
 * Reads a JSON store, or null when the file is missing or corrupted. The
 * corrupted file is kept as <file>.broken (first occurrence only) so data can
 * be recovered — hence the separate null: a caller that deletes files the store
 * points at must be able to tell a lost store from an empty one.
 */
function readJsonOrNull<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.error(`plantar: corrupted JSON store ${file}, falling back to defaults`, err);
    keepBrokenCopy(file);
    return null;
  }
}

/**
 * Reads a JSON store, degrading to a fallback when the file is missing or
 * corrupted: a broken store must never crash startup.
 */
function readJsonSafe<T>(file: string, fallback: T): T {
  return readJsonOrNull<T>(file) ?? fallback;
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
  /** The project the record belongs to. Empty on CLI records (it deploys from
   *  a directory and has no project record) and on records written before the
   *  field existed — those are looked up by name + host */
  projectId?: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "error";
  /** Запись создана возвратом предыдущей версии; отсутствует — обычный деплой.
   *  migrate — the run moved an external project under Plantar management */
  kind?: "deploy" | "rollback" | "migrate";
  url?: string;
  /** How the address answered the availability check (mirrors SiteCheckStatus
   *  from @plantar/core, which storage does not depend on); absent on runs with
   *  no address to check and on records written before the field existed */
  urlCheck?: "answered" | "plain-http" | "no-answer";
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

/** History as it is on disk; null — the file is missing, corrupted or not a list */
function readHistoryOrNull(): DeployRecord[] | null {
  const file = historyFile();
  const history = readJsonOrNull<DeployRecord[]>(file);
  // Same wrong-shape guard as readJsonList — appendHistory pushes into this
  if (Array.isArray(history)) return history;
  // Valid JSON of the wrong shape ({"records": [...]}, say) parses fine, so
  // readJsonOrNull leaves no recovery copy — but the history is lost all the
  // same, and losing it here costs files: pruneDeployLogs keeps alive every log
  // named in the copy. This is also the most hand-recoverable form of a broken
  // history, the records are all there. Only the history gets the copy: the
  // other stores neither delete files nor are read through this function.
  if (history !== null) {
    console.error(
      `plantar: history store ${file} is not a list, falling back to defaults`,
    );
    keepBrokenCopy(file);
  }
  return null;
}

export function readHistory(): DeployRecord[] {
  return readHistoryOrNull() ?? [];
}

/** Every name the project deployed under, the current one first */
export function projectNames(project: ProjectRecord): string[] {
  return [project.name, ...(project.previousNames ?? [])];
}

/** The project whose history is looked up: its id, its names and its host */
export interface ProjectHistoryIdentity {
  projectId: string;
  /** The current name and every previous one — runs from before a rename are
   *  recorded under the name of the time */
  names: string[];
  host: string;
}

/**
 * Whether a record belongs to the project. A record written by the app carries
 * the project id and is matched by it alone, so a rename does not hide it.
 * Records without an id — written by the CLI, which deploys from a directory
 * and has no project record, or written before the field existed — are matched
 * by name + host: the name alone is not enough, since the same app deployed to
 * a staging and a production server yields two projects with one name.
 */
export function matchesProject(
  record: DeployRecord,
  identity: ProjectHistoryIdentity,
): boolean {
  if (record.projectId) return record.projectId === identity.projectId;
  return record.host === identity.host && identity.names.includes(record.project);
}

/** How many deploy records are kept per project on a host; older ones are evicted */
const HISTORY_LIMIT_PER_PROJECT = 200;

/**
 * "<name>\0<host>" -> id of the project that owns that name on that host,
 * including the names it was renamed from, so records without an id are capped
 * together with the rest of their project's history.
 */
function projectIdsByNameHost(): Map<string, string> {
  const hostOf = new Map(readServers().map((s) => [s.id, s.host]));
  const projects = readProjects();
  const ids = new Map<string, string>();
  // Current names are written last on purpose: if a name a project was renamed
  // from is taken by another project today, the record belongs to the latter
  for (const project of projects) {
    const host = hostOf.get(project.serverId);
    if (!host) continue;
    for (const name of project.previousNames ?? []) {
      ids.set(`${name} ${host}`, project.id);
    }
  }
  for (const project of projects) {
    const host = hostOf.get(project.serverId);
    if (host) ids.set(`${project.name} ${host}`, project.id);
  }
  return ids;
}

/**
 * Drops the oldest records of every project beyond the limit, keeping the
 * original order. The cap is per project, because that is how history is read
 * back everywhere: a global cap would let one busy project flush out the
 * records of a rarely deployed one, and a project whose newest record is gone
 * while its deploy log is still on disk reads back as an interrupted deploy.
 * The group is the identity the lookups use — the project id, with name + host
 * resolved onto it — otherwise a rename would split one project into two
 * groups of the full limit each.
 */
function capHistory(history: DeployRecord[]): DeployRecord[] {
  const ids = projectIdsByNameHost();
  const kept = new Map<string, number>();
  const result: DeployRecord[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    const nameHost = `${record.project} ${record.host}`;
    const key = record.projectId ?? ids.get(nameHost) ?? nameHost;
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

/** A log touched more recently than this is treated as still being written */
const LIVE_LOG_WINDOW_MS = 60 * 60 * 1000;

/** A run started more recently than this is never reclaimed, however quiet its file */
const RECENT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Log filenames referenced by the <history>.broken recovery copy, or null when
 * the copy exists but cannot be read. The copy is corrupted JSON — parsing it
 * is off the table — but the filenames in it still appear literally in the
 * text (path separators and quotes cannot occur inside a name), and they are
 * exactly the logs a manual recovery would resurrect. An unreadable copy
 * yields null: the caller must not prune blind while recovery data may exist.
 *
 * The guarantee covers the first loss of the history only: the copy is written
 * once and never overwritten, so after a second one the names here are those of
 * the already recovered history, and the files of the history lost afterwards
 * are pruned as usual. Keeping the copy is what protects the recovery of the
 * copy — a copy that walked forward with every corruption would protect
 * nothing.
 */
function brokenHistoryLogNames(): Set<string> | null {
  const marker = `${historyFile()}.broken`;
  if (!existsSync(marker)) return new Set();
  try {
    return new Set(readFileSync(marker, "utf8").match(/deploy-[^"\\/]+\.log/g) ?? []);
  } catch {
    return null;
  }
}

/**
 * The log directories the records' projects write to: the directory is keyed by
 * the project name as of the deploy, so a project that was renamed has one per
 * name it deployed under. A record without an id (from the CLI, or written
 * before the field existed) only knows its own name. Projects are read once for
 * the whole batch — the caller passes every project the pass has to visit.
 */
function projectLogNames(records: DeployRecord[]): string[] {
  const names: string[] = [];
  const ids = new Set<string>();
  for (const record of records) {
    // A hand-edited history can carry a non-string project: capHistory folds it
    // into a template literal without complaint, and it would reach safeLogDir
    // as a path.join argument and throw out of appendHistory
    if (typeof record?.project !== "string") continue;
    names.push(record.project);
    if (record.projectId) ids.add(record.projectId);
  }
  if (ids.size === 0) return names;
  for (const project of readProjects()) {
    if (ids.has(project.id)) names.push(...projectNames(project));
  }
  return names;
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
 *
 * The name of a file, though, only says when its run started: an overlapping
 * run that started earlier (the same app on a staging and a production server,
 * or the CLI next to the app) is still appending to a file older than the
 * record just written. Deleting it would not even free the space —
 * appendFileSync recreates the file — it would only lose the run's log, so a
 * recently written file is left alone regardless of its name. A quiet stretch
 * (a long remote build writes nothing for a while) would still look dead by
 * mtime, so a run started within the last day is kept as well: too conservative
 * costs a few stale files, too eager loses a running deploy's log.
 *
 * Finally, every filename appearing in the <history>.broken recovery copy is
 * treated as alive for as long as the copy exists: those are exactly the logs
 * a manual recovery of the copy would point back at, and deleting them would
 * defeat the point of keeping it.
 *
 * A renamed project has one directory per name it deployed under, and the cap
 * evicts its records across all of them, so every one of those directories is
 * visited. Each is pruned against the records recorded under its own name,
 * whoever wrote them — that is what keeps the pass from deleting the runs of
 * another project sharing the directory, and what makes the newest-record
 * cutoff mean "newest run that landed in this directory".
 */
function pruneDeployLogs(names: string[], history: DeployRecord[]): void {
  const referenced = brokenHistoryLogNames();
  if (referenced === null) return;
  for (const name of new Set(names)) pruneLogDir(name, history, referenced);
}

/** One log directory of a project; see pruneDeployLogs for the rules */
function pruneLogDir(
  project: string,
  history: DeployRecord[],
  referenced: Set<string>,
): void {
  // A hand-edited or foreign history.json can hold anything Array.isArray lets
  // through. A malformed record (not an object, or no logFile string) is
  // skipped rather than trusted: it must neither abort the pass for the healthy
  // records nor throw out of appendHistory — on the desktop success path that
  // would report a deploy that actually succeeded as failed.
  const records = history.filter(
    (r) => r != null && r.project === project && typeof r.logFile === "string",
  );
  if (records.length === 0) return;
  // Protection comes first: a record still listed in the UI keeps its file,
  // whatever else is wrong with it. Only the cutoff below needs a startedAt.
  const kept = new Set(records.map((r) => path.basename(r.logFile)));
  for (const name of referenced) kept.add(name);
  // A record without a startedAt string cannot seed the newest-record cutoff:
  // the reduce would start from undefined, every comparison against it is
  // false, and the interrupted-run protection would silently switch itself off
  // for the whole directory. With no dated record at all the cutoff is unknown,
  // so nothing is pruned rather than everything.
  const dated = records.filter((r) => typeof r.startedAt === "string");
  if (dated.length === 0) return;
  const newest = dated.reduce(
    (max, r) => (r.startedAt > max ? r.startedAt : max),
    dated[0].startedAt,
  );
  const dir = safeLogDir(project);
  if (dir === null || !existsSync(dir)) return;
  try {
    for (const name of readdirSync(dir)) {
      if (!/^deploy-.*\.log$/.test(name) || kept.has(name)) continue;
      const time = deployLogTimestamp(name);
      if (time === null || time > newest) continue;
      if (Date.parse(time) > Date.now() - RECENT_RUN_WINDOW_MS) continue;
      const file = path.join(dir, name);
      try {
        if (statSync(file).mtimeMs > Date.now() - LIVE_LOG_WINDOW_MS) continue;
        rmSync(file);
      } catch {
        // best effort — a locked or vanished file must not fail the deploy
      }
    }
  } catch {
    // best effort — an unreadable directory must not fail the deploy
  }
}

/**
 * Drops the history records of a project — for when the project itself is
 * removed together with its logs: a record whose file is gone would open as a
 * raw filesystem error if the project were added again under the same name.
 */
export function removeProjectHistory(project: string): void {
  try {
    const history = readHistory();
    const kept = history.filter((r) => r.project !== project);
    if (kept.length !== history.length) writeJsonAtomic(historyFile(), kept);
  } catch {
    // best effort — a failed write must not fail removing the project
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
  const previous = readHistoryOrNull();
  const history = [...(previous ?? []), record];
  const capped = capHistory(history);
  writeJsonAtomic(historyFile(), capped);
  // A degraded read skips pruning for this one append: the history just
  // written knows about this single record only. The skip alone would merely
  // delay the problem by one deploy — the next append reads that one-record
  // history back as healthy — so the durable protection lives inside
  // pruneDeployLogs itself: every filename in the <file>.broken recovery copy
  // stays alive for as long as the copy exists, however many deploys later.
  // A genuinely fresh install has nothing to prune anyway.
  if (previous === null) return;
  // One capHistory call evicts records of every project at once — the first
  // append after an upgrade from an unbounded history trims them all — so the
  // pass covers the projects it actually evicted from, not just this record's:
  // otherwise their run files stay on disk until that project deploys again,
  // which for an abandoned project is never. Evicted records are found by
  // reference (capHistory puts the very same objects into its result); records
  // are not unique by their fields, so a value comparison would not do. With
  // nothing evicted — the usual case — the set is this record's project alone
  // and the pass scans exactly as many directories as before.
  const kept = new Set(capped);
  const evicted = history.filter((r) => !kept.has(r));
  pruneDeployLogs(projectLogNames([record, ...evicted]), capped);
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
