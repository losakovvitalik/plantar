/**
 * Error-handling convention of this package:
 *
 * - Reads log-and-degrade: a broken store must never crash startup.
 *   readJsonOrNull returns null and keeps a .broken recovery copy when the
 *   caller must tell a lost store from an empty one; readJsonSafe falls back
 *   to a default otherwise.
 * - Writes throw: the caller decides how a failed save reaches the user
 *   (writeJsonAtomic and everything built on top of it).
 * - Deletions return a success indicator instead of throwing: the caller
 *   decides whether a failed cleanup matters.
 * - Internal best-effort maintenance (pruneDeployLogs and friends) swallows
 *   errors deliberately; each swallow carries a comment justifying it.
 *
 * A new function follows these rules or says in a comment why it cannot.
 *
 * The implementation lives in per-domain modules; this entry re-exports the
 * public surface: paths, deploy-logs, records, settings, history, caches.
 */
export type { Language } from "@plantar/i18n";
export { type LastDeployRun, deployLogTimestamp, resolveLastRun } from "./last-run";
export { dataDir, keysDir, reposDir } from "./paths";
export {
  DeployLogWriter,
  type RemoveProjectLogsResult,
  listDeployLogs,
  readLogTail,
  removeProjectLogs,
  saveServerLogSnapshot,
} from "./deploy-logs";
export {
  type DeployedCommit,
  type ExternalAppInfo,
  type ProjectRecord,
  type ServerRecord,
  projectNames,
  readProjects,
  readServers,
  writeProjects,
  writeServers,
} from "./records";
export { type AppSettings, readSettings, writeSettings } from "./settings";
export {
  type DeployRecord,
  type ProjectHistoryIdentity,
  appendHistory,
  matchesProject,
  readHistory,
  removeProjectHistory,
} from "./history";
export {
  type AppStatus,
  type AppStatusEntry,
  type CachedCommit,
  type CommitsCacheEntry,
  type StatusTabCacheEntry,
  readAppStatusCache,
  readCommitsCache,
  readStatusTabCache,
  writeAppStatusCache,
  writeCommitsCache,
  writeStatusTabCache,
} from "./caches";
