import {
  checkSitesRespond,
  discoverApps,
  getServerInfo,
  getTrafficStats,
  listReleases,
  markSharedLog,
  pm2LogExpr,
  pm2ProcessHealth,
  SHARED_LOG_TRAFFIC,
} from "@plantar/core";
import { type SshConnection, shellQuote } from "@plantar/ssh";
import { type ProjectRecord, type ServerRecord } from "@plantar/storage";
import { z } from "zod";
import { t } from "./messages";
import type { McpProvider } from "./provider";

/** Shape of an MCP tool result (a subset of the SDK's CallToolResult) */
export interface ToolResult {
  // The SDK's CallToolResult carries an index signature — mirrored here so
  // the handlers are assignable to its callbacks without casts
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  // Loosely typed on purpose: each tool narrows its own args, and the HTTP
  // layer registers the handlers behind zod-validated schemas
  handler: (args: any) => Promise<ToolResult>;
}

/** At most this much of a deploy log enters a tool result — logs are unbounded */
const DEPLOY_LOG_TAIL_BYTES = 32_000;

const DEFAULT_LOG_LINES = 100;

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function findServer(provider: McpProvider, serverId: string): ServerRecord {
  const server = provider.listServers().find((s) => s.id === serverId);
  if (!server) throw new Error(t("serverNotFound"));
  return server;
}

function findProject(
  provider: McpProvider,
  projectId: string,
): { project: ProjectRecord; server: ServerRecord } {
  const project = provider.listProjects().find((p) => p.id === projectId);
  if (!project) throw new Error(t("projectNotFound"));
  return { project, server: findServer(provider, project.serverId) };
}

/** Tail of a remote file; the path is an already-quoted shell expression */
async function tailQuoted(
  conn: SshConnection,
  quotedPath: string,
  lines: number,
): Promise<string> {
  const result = await conn.exec(`tail -n ${lines} ${quotedPath} 2>/dev/null`);
  return result.stdout.trimEnd();
}

export function createTools(provider: McpProvider): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "list_servers",
      description:
        "List the servers configured in Plantar: id, name, host, port, user and auth kind. " +
        "Server ids are the input of the server-scoped tools.",
      inputSchema: {},
      handler: async () =>
        // keyPath points at encrypted key material — it never leaves the app
        ok(provider.listServers().map(({ keyPath: _keyPath, ...server }) => server)),
    },
    {
      name: "list_projects",
      description:
        "List the projects (apps) configured in Plantar with the server each one is deployed to. " +
        "Project ids are the input of the project-scoped tools.",
      inputSchema: {},
      handler: async () => ok(provider.listProjects()),
    },
    {
      name: "get_server_info",
      description:
        "OS, CPU, memory, free disk space and installed tool versions of a server.",
      inputSchema: { serverId: z.string().describe("Server id from list_servers") },
      handler: async ({ serverId }: { serverId: string }) => {
        findServer(provider, serverId);
        return ok(await provider.withConnection(serverId, (conn) => getServerInfo(conn)));
      },
    },
    {
      name: "get_app_status",
      description:
        "Live status of an app: pm2 process health (status, uptime, restarts, CPU, memory) " +
        "and whether its site answers over HTTP, checked from the server itself.",
      inputSchema: { projectId: z.string().describe("Project id from list_projects") },
      handler: async ({ projectId }: { projectId: string }) => {
        const { project } = findProject(provider, projectId);
        const runtime = provider.projectRuntime(project);
        return ok(
          await provider.withConnection(project.serverId, async (conn) => {
            const health = await pm2ProcessHealth(conn);
            const responds = runtime.siteUrl
              ? (await checkSitesRespond(conn, [runtime.siteUrl]))[0]
              : undefined;
            return {
              process: health.get(runtime.pm2Name) ?? null,
              siteUrl: runtime.siteUrl ?? null,
              siteResponds: responds ?? null,
            };
          }),
        );
      },
    },
    {
      name: "get_logs",
      description:
        "Tail of an app's logs on the server. source=app reads the pm2 process logs " +
        "(stdout and stderr), source=nginx reads the app's nginx access and error logs.",
      inputSchema: {
        projectId: z.string().describe("Project id from list_projects"),
        source: z.enum(["app", "nginx"]).describe("Which logs to read"),
        lines: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(DEFAULT_LOG_LINES)
          .describe("How many trailing lines to return"),
      },
      handler: async ({
        projectId,
        source,
        lines = DEFAULT_LOG_LINES,
      }: {
        projectId: string;
        source: "app" | "nginx";
        lines?: number;
      }) => {
        const { project } = findProject(provider, projectId);
        const runtime = provider.projectRuntime(project);
        return ok(
          await provider.withConnection(project.serverId, async (conn) => {
            if (source === "nginx") {
              const read = (logPath: string | null) =>
                logPath === null ? null : tailQuoted(conn, shellQuote(logPath), lines);
              return {
                accessLogPath: runtime.accessLogPath,
                errorLogPath: runtime.errorLogPath,
                access: await read(runtime.accessLogPath),
                error: await read(runtime.errorLogPath),
              };
            }
            const out = runtime.outLogPath
              ? shellQuote(runtime.outLogPath)
              : pm2LogExpr(runtime.pm2Name, "out");
            const err = runtime.errLogPath
              ? shellQuote(runtime.errLogPath)
              : pm2LogExpr(runtime.pm2Name, "error");
            return {
              output: await tailQuoted(conn, out, lines),
              errors: await tailQuoted(conn, err, lines),
            };
          }),
        );
      },
    },
    {
      name: "get_traffic_stats",
      description:
        "Visits summary of an app parsed from its nginx access log (about two weeks of data): " +
        "totals, by day, by hour, status code families and top paths. " +
        "sharedLog=true means the app writes into the server-wide log and its visits cannot be separated.",
      inputSchema: { projectId: z.string().describe("Project id from list_projects") },
      handler: async ({ projectId }: { projectId: string }) => {
        const { project } = findProject(provider, projectId);
        const runtime = provider.projectRuntime(project);
        if (runtime.accessLogPath === null) return ok(SHARED_LOG_TRAFFIC);
        const logPath = runtime.accessLogPath;
        const stats = await provider.withConnection(project.serverId, (conn) =>
          getTrafficStats(conn, logPath),
        );
        return ok(markSharedLog(Boolean(project.external), stats));
      },
    },
    {
      name: "list_releases",
      description:
        "Deployed release versions of an app kept on the server, newest first, " +
        "and which one is currently live. Imported apps managed in place have none.",
      inputSchema: { projectId: z.string().describe("Project id from list_projects") },
      handler: async ({ projectId }: { projectId: string }) => {
        const { project } = findProject(provider, projectId);
        const runtime = provider.projectRuntime(project);
        return ok(
          await provider.withConnection(project.serverId, (conn) =>
            listReleases(conn, runtime.name),
          ),
        );
      },
    },
    {
      name: "get_deploy_history",
      description:
        "Deploy history of a project recorded by Plantar, newest first: when, success or error, " +
        "deployed commit and rollbacks. Optionally includes the tail of the newest run's log.",
      inputSchema: {
        projectId: z.string().describe("Project id from list_projects"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("How many records to return"),
        includeLastRunLog: z
          .boolean()
          .default(false)
          .describe("Attach the tail of the newest run's deploy log"),
      },
      handler: async ({
        projectId,
        limit = 20,
        includeLastRunLog = false,
      }: {
        projectId: string;
        limit?: number;
        includeLastRunLog?: boolean;
      }) => {
        const { project } = findProject(provider, projectId);
        const records = provider.deployHistory(project).slice(0, limit);
        let lastRunLog: string | undefined;
        if (includeLastRunLog && records[0]) {
          try {
            lastRunLog = provider.readDeployLogTail(records[0].logFile, DEPLOY_LOG_TAIL_BYTES);
          } catch {
            // The file may have been pruned — the records are still useful
          }
        }
        return ok({
          records: records.map(({ logFile: _logFile, ...record }) => record),
          ...(lastRunLog === undefined ? {} : { lastRunLog }),
        });
      },
    },
    {
      name: "discover_apps",
      description:
        "Find the apps running on a server that are not necessarily managed by Plantar: " +
        "pm2 processes with their ports, domains, log paths and git origin. Changes nothing on the server.",
      inputSchema: { serverId: z.string().describe("Server id from list_servers") },
      handler: async ({ serverId }: { serverId: string }) => {
        findServer(provider, serverId);
        return ok(await provider.withConnection(serverId, (conn) => discoverApps(conn)));
      },
    },
    {
      name: "list_files",
      description: "List the subdirectories of a directory on a server (names only).",
      inputSchema: {
        serverId: z.string().describe("Server id from list_servers"),
        path: z.string().describe("Absolute directory path on the server"),
      },
      handler: async ({ serverId, path }: { serverId: string; path: string }) => {
        findServer(provider, serverId);
        return ok(
          await provider.withConnection(serverId, (conn) => conn.listDirectories(path)),
        );
      },
    },
  ];

  return tools.map((tool) => ({ ...tool, handler: guarded(tool.handler) }));
}

/** Tool errors travel as results, not protocol errors — agents read them as text */
function guarded(
  handler: ToolDefinition["handler"],
): (args: Record<string, unknown>) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Agents tend to fall back to direct SSH right after a tool failure —
      // steer them back to the user at exactly that decision point
      return { isError: true, content: [{ type: "text", text: `${message} ${t("bypassHint")}` }] };
    }
  };
}
