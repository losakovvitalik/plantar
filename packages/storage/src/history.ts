import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { keepBrokenCopy, readJsonOrNull, writeJsonAtomic } from "./json-store";
import { deployLogTimestamp } from "./last-run";
import { dataDir, safeLogDir } from "./paths";
import { readProjects, readServers, projectNames } from "./records";

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

/** Separator in "<name>\0<host>" map keys — NUL can appear in neither part */
const KEY_SEP = "\0";

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
      ids.set(`${name}${KEY_SEP}${host}`, project.id);
    }
  }
  for (const project of projects) {
    const host = hostOf.get(project.serverId);
    if (host) ids.set(`${project.name}${KEY_SEP}${host}`, project.id);
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
    const nameHost = `${record.project}${KEY_SEP}${record.host}`;
    const key = record.projectId ?? ids.get(nameHost) ?? nameHost;
    const count = kept.get(key) ?? 0;
    if (count >= HISTORY_LIMIT_PER_PROJECT) continue;
    kept.set(key, count + 1);
    result.push(record);
  }
  return result.reverse();
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
 * record just written. Deleting it would not even free the space — the
 * writer holds the file open until the run ends — it would only lose the
 * run's log, so a recently written file is left alone regardless of its
 * name. A quiet stretch
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
 * cutoff mean "newest run that landed in this directory". A directory whose
 * records the cap evicted in full (every old-name record of a renamed project
 * falls out in one call once the new name accumulates the limit) has no record
 * of its own left to define that cutoff, and none will ever come back — so for
 * it the cutoff falls back to the newest startedAt across the whole capped
 * history instead of leaving the directory unpruned forever.
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
  // Protection comes first: a record still listed in the UI keeps its file,
  // whatever else is wrong with it. Only the cutoff below needs a startedAt.
  const kept = new Set(records.map((r) => path.basename(r.logFile)));
  for (const name of referenced) kept.add(name);
  // A record without a startedAt string cannot seed the newest-record cutoff:
  // the reduce would start from undefined, every comparison against it is
  // false, and the interrupted-run protection would silently switch itself off
  // for the whole directory. With records but none of them dated the cutoff is
  // unknown, so nothing is pruned rather than everything. With no record at
  // all — the cap evicted every record of this directory in one call, and they
  // never come back — the cutoff falls back to the newest startedAt across the
  // whole capped history: nothing recorded anywhere started later, and a run
  // still in flight here is protected by the two time windows below as usual.
  const own = records.filter((r) => typeof r.startedAt === "string");
  const dated =
    records.length > 0
      ? own
      : history.filter((r) => r != null && typeof r.startedAt === "string");
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
 * Returns false when the pruned history could not be written back — a failed
 * cleanup must not fail removing the project, so the caller decides.
 */
export function removeProjectHistory(project: string): boolean {
  try {
    const history = readHistory();
    const kept = history.filter((r) => r.project !== project);
    if (kept.length !== history.length) writeJsonAtomic(historyFile(), kept);
    return true;
  } catch {
    return false;
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
