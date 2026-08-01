import type { SiteCheckStatus } from "@plantar/core";
import type { SshConnection } from "@plantar/ssh";
import type { DeployRecord, ProjectRecord, ServerRecord } from "@plantar/storage";

/**
 * Snapshot of a project's current or last deploy run, as the host application
 * tracks it (DeployRunState in the desktop app, minus renderer-only fields).
 * interrupted — the app was closed mid-deploy and the run was restored from disk.
 */
export interface DeployRunSnapshot {
  kind: "deploy" | "rollback" | "migrate";
  status: "running" | "success" | "error" | "interrupted";
  /** Tail of the run's log lines; the full log stays in the host's log file */
  lines: string[];
  startedAt: string;
  /** Time of the last log line — how long the current step has been quiet */
  lastLineAt: string;
  url?: string;
  /** How the address answered the availability check after the run */
  urlCheck?: SiteCheckStatus;
  error?: string;
  /** Machine-readable error code (e.g. npm-peer-conflict) */
  errorCode?: string;
}

/**
 * What the host application derives from a project's config for the tools:
 * reading plantar.json and resolving log paths stays in the desktop app
 * (see trafficLogPath in apps/desktop/src/main/traffic-log.ts).
 */
export interface ProjectRuntime {
  /** Name from plantar.json when readable; the record's name otherwise */
  name: string;
  /** pm2 process name; an imported app keeps its original one */
  pm2Name: string;
  /** URL the site should answer on; bots and unconfigured apps have none */
  siteUrl?: string;
  /** nginx access log the app writes visits to; null — no log of its own */
  accessLogPath: string | null;
  /** nginx error log; null when an imported app's config names none */
  errorLogPath: string | null;
  /** pm2 process logs of an imported app; undefined — the default pm2 paths apply */
  outLogPath?: string;
  errLogPath?: string;
}

/**
 * The bridge the host application wires the tools to. SSH goes through the
 * host's connection pool — private keys are decrypted only inside Electron,
 * which is exactly why this package never connects on its own.
 */
export interface McpProvider {
  listServers(): ServerRecord[];
  listProjects(): ProjectRecord[];
  /**
   * Deploy history records of the project, newest first. Matching records to
   * the project (by id, current and previous names, host) stays in the host
   * application so the MCP and GUI histories cannot diverge.
   */
  deployHistory(project: ProjectRecord): DeployRecord[];
  /** Tail of a local deploy log file, at most maxBytes */
  readDeployLogTail(file: string, maxBytes: number): string;
  /**
   * Runs fn on a pooled SSH connection of the server. Must reject with a
   * readable message for a password-auth server without a live connection.
   */
  withConnection<T>(serverId: string, fn: (conn: SshConnection) => Promise<T>): Promise<T>;
  projectRuntime(project: ProjectRecord): ProjectRuntime;
  /**
   * Whether the settings allow agents to start deploys. Checked on every
   * createTools call — the HTTP layer builds a server per request, so the
   * toolset follows the setting without restarting the listener.
   */
  deploysAllowed(): boolean;
  /**
   * Starts a deploy of the project without awaiting completion and resolves
   * with the started run's state; rejects when the run refused to start (a run
   * is already active, or a password-auth server has no live connection).
   * The run must go through the host's own registry (startDeployRun in the
   * desktop app) so GUI and agent views of it cannot diverge.
   */
  startDeploy(project: ProjectRecord): Promise<DeployRunSnapshot>;
  /**
   * Same contract for returning to the previous version. Must reject with a
   * readable message for an imported (external) project.
   */
  startRollback(project: ProjectRecord): Promise<DeployRunSnapshot>;
  /** Current or last run of the project; null — no runs to report */
  deployRunState(project: ProjectRecord): DeployRunSnapshot | null;
}
