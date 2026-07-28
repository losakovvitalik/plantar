import type { SshConnection } from "@plantar/ssh";
import type { DeployRecord, ProjectRecord, ServerRecord } from "@plantar/storage";

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
  deployHistory(): DeployRecord[];
  /** Tail of a local deploy log file, at most maxBytes */
  readDeployLogTail(file: string, maxBytes: number): string;
  /**
   * Runs fn on a pooled SSH connection of the server. Must reject with a
   * readable message for a password-auth server without a live connection.
   */
  withConnection<T>(serverId: string, fn: (conn: SshConnection) => Promise<T>): Promise<T>;
  projectRuntime(project: ProjectRecord): ProjectRuntime;
}
