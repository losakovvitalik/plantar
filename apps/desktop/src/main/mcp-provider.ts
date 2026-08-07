import { appErrorLogPath } from "@plantar/core/paths";
import type { DeployRunSnapshot, McpProvider, ProjectRuntime } from "@plantar/mcp";
import {
  type ProjectRecord,
  type ServerRecord,
  readLogTail,
  readProjects,
  readServers,
  readSettings,
} from "@plantar/storage";
import type { DeployRunState } from "../shared/ipc";
import { withServer } from "./connections";
import { runDeploy, runRollback } from "./deploy-orchestrators";
import { deployRunState } from "./deploy-runs";
import { t } from "./i18n";
import { projectHistory, restoredDeployState } from "./project-history";
import { getServer, projectSite } from "./records";
import { isConnected } from "./ssh-pool";
import { trafficLogPath } from "./traffic-log";

/** What the MCP tools need from a project's config; plantar.json stays here */
function mcpProjectRuntime(project: ProjectRecord): ProjectRuntime {
  const { name, siteUrl } = projectSite(project, getServer(project.serverId).host);
  const external = project.external;
  return {
    name,
    pm2Name: external ? external.pm2Name : name,
    siteUrl,
    accessLogPath: trafficLogPath(project, name),
    // An imported app keeps the error log its config names (none — null);
    // a managed one gets the path Plantar's own nginx template writes
    errorLogPath: external ? (external.errorLogPath ?? null) : appErrorLogPath(name),
    outLogPath: external?.outLogPath,
    errLogPath: external?.errLogPath,
  };
}

/** The server of the id, refusing a password-auth server without a live pooled
 *  connection — MCP passes no password, so only a reused connection can work */
function mcpRequireConnection(serverId: string): ServerRecord {
  const server = getServer(serverId);
  if (server.auth === "password" && !isConnected(server.id)) {
    throw new Error(t("mcpConnectInApp"));
  }
  return server;
}

/** lastSeq only closes a renderer subscription race — agents poll snapshots */
function mcpStripLastSeq(state: DeployRunState): DeployRunSnapshot {
  const { lastSeq: _lastSeq, ...snapshot } = state;
  return snapshot;
}

/** Run state for MCP; falls back to the on-disk restore after an app restart —
 *  the same view the deploy:state IPC handler serves the GUI */
function mcpRunSnapshot(project: ProjectRecord): DeployRunSnapshot | null {
  const state = deployRunState(project.id) ?? restoredDeployState(project);
  return state ? mcpStripLastSeq(state) : null;
}

/**
 * Fires a deploy/rollback run without awaiting completion. The refusals to
 * start (a run already active, an external project's rollback, no config)
 * throw before the run's first await, so their rejection settles in a
 * microtask — ahead of the zero timer; anything past that point keeps running
 * in the background, reporting through the run state and history exactly like
 * a GUI-started run.
 */
async function startMcpRun(
  project: ProjectRecord,
  run: () => Promise<unknown>,
): Promise<DeployRunSnapshot> {
  const promise = run();
  // The MCP call stops waiting once the run started; late failures are
  // reported by the run state, not by an unhandled rejection
  promise.catch(() => {});
  const failure = await Promise.race([
    promise.then(
      () => null,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
  ]);
  if (failure) throw failure;
  // The run registered itself in startDeployRun before its first await, so an
  // in-memory state must exist here — read memory only (no restoredDeployState
  // fallback, which could mask a broken invariant with a stale restored run)
  // and fail loudly if it ever does not
  const state = deployRunState(project.id);
  // Developer-facing invariant, intentionally not localized: it signals a bug
  // in Plantar itself (MCP tooling reports it), never a normal user-visible flow
  if (!state) throw new Error(`No run state right after starting a run of ${project.id}`);
  return mcpStripLastSeq(state);
}

/**
 * The bridge the MCP tools run through: storage reads plus the SSH pool.
 * Password-auth servers store no secret, so their tools work only while a
 * live pooled connection exists — the same limitation the background
 * monitor has (see forgetServer/startAppMonitor).
 */
export const mcpProvider: McpProvider = {
  listServers: readServers,
  listProjects: readProjects,
  // The same record lookup the GUI history uses: renames and ID-less CLI runs
  // are matched there, so the two histories cannot diverge
  deployHistory: projectHistory,
  readDeployLogTail: (file, maxBytes) => readLogTail(file, maxBytes),
  withConnection: async (serverId, fn) => {
    const server = mcpRequireConnection(serverId);
    return withServer(server, undefined, fn);
  },
  projectRuntime: mcpProjectRuntime,
  deploysAllowed: () => readSettings().mcpAllowDeploy,
  startDeploy: async (project) => {
    // Fail before the run starts: a password-auth server without a live
    // connection would otherwise start a run that dies halfway
    mcpRequireConnection(project.serverId);
    // The same routing the deploy:run IPC handler uses — runDeploy sends an
    // imported project through runExternalInPlace; migrate is never set here
    return startMcpRun(project, () => runDeploy(project.id, undefined));
  },
  startRollback: async (project) => {
    mcpRequireConnection(project.serverId);
    // runRollback itself refuses an imported project with a readable message
    return startMcpRun(project, () => runRollback(project.id, undefined));
  },
  deployRunState: mcpRunSnapshot,
};
