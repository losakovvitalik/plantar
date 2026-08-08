import {
  type DeployRecord,
  type ProjectHistoryIdentity,
  type ProjectRecord,
  type ServerRecord,
  deployLogTimestamp,
  listDeployLogs,
  matchesProject,
  projectNames,
  readHistory,
  readLogTail,
  readProjects,
  readServers,
  resolveLastRun,
} from "@plantar/storage";
import type { DeployRunState } from "../shared/ipc";
import { t } from "./i18n";
import { currentName } from "./records";

/**
 * One snapshot of the JSON stores the history lookups read. A sweep over many
 * projects builds it once and passes it down — otherwise every project would
 * re-read servers.json, projects.json and the whole history.json from disk.
 */
export interface HistoryStores {
  servers: ServerRecord[];
  projects: ProjectRecord[];
  history: DeployRecord[];
  /** Current name per project id, precomputed for a sweep; absent — resolve on demand */
  names?: Map<string, string>;
}

export function readHistoryStores(): HistoryStores {
  return { servers: readServers(), projects: readProjects(), history: readHistory() };
}

/**
 * Current names of every project resolved once. A sweep builds this map next
 * to `readHistoryStores()` and threads it down — otherwise `historyIdentity`
 * would re-read every same-host project's plantar.json per static site. Keeps
 * `currentName`'s fallback: an unreadable config maps to the record name.
 */
export function currentNamesById(projects: ProjectRecord[]): Map<string, string> {
  return new Map(projects.map((p) => [p.id, currentName(p)]));
}

/**
 * The project to look its history records up by: the id of the project record
 * plus every name it deployed under — runs from before a rename are recorded
 * under the previous name and without an id (from the CLI or before the field
 * existed).
 */
export function historyIdentity(
  project: ProjectRecord,
  stores: Pick<HistoryStores, "servers" | "projects" | "names"> = {
    servers: readServers(),
    projects: readProjects(),
  },
): ProjectHistoryIdentity {
  const server = stores.servers.find((s) => s.id === project.serverId);
  if (!server) throw new Error(t("serverNotFound"));
  const hostOf = new Map(stores.servers.map((s) => [s.id, s.host]));
  // Sweeps precompute the names; without the map each call reads plantar.json
  const nameOf = (p: ProjectRecord): string => stores.names?.get(p.id) ?? currentName(p);
  // A previous name that another project on the same host goes by today belongs
  // to that project: its records and its log directory are no longer ours
  const taken = new Set(
    stores.projects
      .filter((p) => p.id !== project.id && hostOf.get(p.serverId) === server.host)
      .map(nameOf),
  );
  return {
    projectId: project.id,
    names: [nameOf(project), ...projectNames(project).filter((n) => !taken.has(n))],
    host: server.host,
  };
}

/** Записи истории деплоев проекта, новыми вперёд (включая прогоны до переименования) */
export function projectHistory(
  project: ProjectRecord,
  stores: HistoryStores = readHistoryStores(),
): DeployRecord[] {
  const identity = historyIdentity(project, stores);
  return stores.history.filter((r) => matchesProject(r, identity)).reverse();
}

/**
 * Последний прогон проекта с диска — когда прогона нет в памяти
 * (приложение перезапустили). Свежайший deploy-*.log сверяется с историей:
 * есть запись — прогон завершён, файл новее последней записи — деплой
 * был прерван.
 */
export function restoredDeployState(project: ProjectRecord): DeployRunState | null {
  const identity = historyIdentity(project);
  const history = readHistory().filter((r) => matchesProject(r, identity));
  const last = resolveLastRun(listDeployLogs(identity.names), history);
  if (!last) return null;
  let text = "";
  try {
    text = readLogTail(last.logFile);
  } catch {
    /* файл лога удалён — показываем результат из истории без лога */
  }
  const record = last.record;
  const startedAt = record?.startedAt ?? deployLogTimestamp(last.logFile) ?? "";
  return {
    kind: record?.kind ?? "deploy",
    status: record ? record.status : "interrupted",
    lines: text ? text.replace(/\n$/, "").split("\n") : [],
    lastSeq: 0,
    startedAt,
    lastLineAt: record?.finishedAt ?? startedAt,
    url: record?.url,
    urlCheck: record?.urlCheck,
    error: record?.error,
    errorCode: record?.code,
  };
}
