import { beforeAll, describe, expect, it, vi } from "vitest";
import { setLanguage } from "@plantar/i18n";
import type { SshConnection } from "@plantar/ssh";
import type { DeployRecord, ProjectRecord, ServerRecord } from "@plantar/storage";
import type { DeployRunSnapshot, McpProvider, ProjectRuntime } from "./provider";
import { createTools, type ToolDefinition } from "./tools";

beforeAll(() => setLanguage("en"));

const keyServer: ServerRecord = {
  id: "srv-1",
  name: "test",
  host: "1.2.3.4",
  port: 22,
  user: "root",
  auth: "key",
  keyPath: "/keys/srv-1.pem",
};

const project: ProjectRecord = {
  id: "prj-1",
  serverId: "srv-1",
  name: "shop",
  path: "/home/user/shop",
};

const runtime: ProjectRuntime = {
  name: "shop",
  pm2Name: "shop",
  siteUrl: "https://shop.example/",
  accessLogPath: "/var/log/nginx/shop.access.log",
  errorLogPath: "/var/log/nginx/shop.error.log",
};

const runningRun: DeployRunSnapshot = {
  kind: "deploy",
  status: "running",
  lines: ["Updating the repository..."],
  startedAt: "2026-08-01T10:00:00.000Z",
  lastLineAt: "2026-08-01T10:00:01.000Z",
};

function makeProvider(overrides: Partial<McpProvider> = {}): McpProvider {
  return {
    listServers: () => [keyServer],
    listProjects: () => [project],
    deployHistory: () => [],
    readDeployLogTail: () => "",
    withConnection: async () => {
      throw new Error("withConnection not stubbed for this test");
    },
    projectRuntime: () => runtime,
    deploysAllowed: () => true,
    startDeploy: async () => {
      throw new Error("startDeploy not stubbed for this test");
    },
    startRollback: async () => {
      throw new Error("startRollback not stubbed for this test");
    },
    deployRunState: () => null,
    ...overrides,
  };
}

function toolByName(provider: McpProvider, name: string): ToolDefinition {
  const tool = createTools(provider).find((t) => t.name === name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool;
}

/** Fake SshConnection whose exec answers by command; unmatched commands succeed empty */
function fakeConn(
  respond: (cmd: string) => { stdout?: string; stderr?: string; code?: number } | undefined,
): SshConnection {
  return {
    exec: async (cmd: string) => ({ stdout: "", stderr: "", code: 0, ...respond(cmd) }),
  } as unknown as SshConnection;
}

function parsed(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("list_servers", () => {
  it("strips key paths from the records", async () => {
    const result = await toolByName(makeProvider(), "list_servers").handler({});
    expect(result.isError).toBeUndefined();
    const servers = parsed(result) as Record<string, unknown>[];
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: "srv-1", host: "1.2.3.4", auth: "key" });
    expect(servers[0]).not.toHaveProperty("keyPath");
    expect(result.content[0].text).not.toContain("/keys/");
  });
});

describe("get_server_info", () => {
  it("returns the server info collected over SSH", async () => {
    // getServerInfo runs all checks as one combined command; each check's
    // output is fenced by section/exit markers (see serverInfoCommand in core)
    const section = (name: string, output: string, code = 0) =>
      `__PLANTAR_SECTION__${name}\n${output}\n__PLANTAR_EXIT__${code}\n`;
    const conn = fakeConn((cmd) => {
      if (cmd.includes("__PLANTAR_SECTION__")) {
        return {
          stdout:
            section(
              "os-release",
              'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"',
            ) +
            section("nproc", "2") +
            section("meminfo", "MemTotal:  2048000 kB") +
            section("disk", "10485760") +
            section("tool:node", "v22.0.0"),
        };
      }
      return { code: 1 };
    });
    const provider = makeProvider({
      withConnection: async (serverId, fn) => {
        expect(serverId).toBe("srv-1");
        return fn(conn);
      },
    });
    const result = await toolByName(provider, "get_server_info").handler({
      serverId: "srv-1",
    });
    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({
      os: { id: "ubuntu", version: "24.04" },
      supported: true,
      cpuCores: 2,
      memoryTotalMb: 2000,
      tools: { node: "v22.0.0" },
    });
  });

  it("rejects an unknown server id with a readable error", async () => {
    const result = await toolByName(makeProvider(), "get_server_info").handler({
      serverId: "nope",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No server with this id");
  });

  it("relays the provider's no-live-connection error as a tool error", async () => {
    const provider = makeProvider({
      withConnection: async () => {
        throw new Error("Connect to the server in the Plantar app, then retry.");
      },
    });
    const result = await toolByName(provider, "get_server_info").handler({
      serverId: "srv-1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Connect to the server in the Plantar app");
  });
});

describe("guarded tool errors", () => {
  it("appends the anti-bypass hint after the original error message", async () => {
    const provider = makeProvider({
      withConnection: async () => {
        throw new Error("connection refused");
      },
    });
    const result = await toolByName(provider, "get_server_info").handler({
      serverId: "srv-1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("connection refused");
    expect(result.content[0].text).toContain(
      "Do not work around this by connecting to the server directly over SSH",
    );
  });
});

describe("project-scoped tools", () => {
  it("reject an unknown project id with a readable error", async () => {
    const result = await toolByName(makeProvider(), "get_app_status").handler({
      projectId: "nope",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No project with this id");
  });
});

describe("get_traffic_stats", () => {
  it("returns the shared-log summary without opening a connection", async () => {
    const withConnection = vi.fn();
    const provider = makeProvider({
      withConnection: withConnection as unknown as McpProvider["withConnection"],
      projectRuntime: () => ({ ...runtime, accessLogPath: null }),
    });
    const result = await toolByName(provider, "get_traffic_stats").handler({
      projectId: "prj-1",
    });
    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({ logMissing: true, sharedLog: true, totalHits: 0 });
    expect(withConnection).not.toHaveBeenCalled();
  });
});

describe("get_deploy_history", () => {
  const record = (over: Partial<DeployRecord>): DeployRecord => ({
    project: "shop",
    host: "1.2.3.4",
    projectId: "prj-1",
    startedAt: "2026-07-01T10:00:00.000Z",
    finishedAt: "2026-07-01T10:01:00.000Z",
    status: "success",
    logFile: "/local/logs/shop/deploy-1.log",
    ...over,
  });

  it("returns the provider's records for the project without local log paths", async () => {
    // Matching records to the project (renames, ID-less CLI runs) lives in
    // the provider — the tool only limits and strips local paths
    const deployHistory = vi.fn(() => [
      record({ startedAt: "2026-07-02T10:00:00.000Z", status: "error" }),
      record({ startedAt: "2026-07-01T10:00:00.000Z" }),
    ]);
    const provider = makeProvider({ deployHistory });
    const result = await toolByName(provider, "get_deploy_history").handler({
      projectId: "prj-1",
      limit: 1,
      includeLastRunLog: false,
    });
    expect(deployHistory).toHaveBeenCalledWith(project);
    const data = parsed(result) as { records: Record<string, unknown>[]; lastRunLog?: string };
    expect(data.records).toHaveLength(1);
    expect(data.records[0]).toMatchObject({ status: "error" });
    expect(data.records[0]).not.toHaveProperty("logFile");
    expect(data.lastRunLog).toBeUndefined();
  });

  it("attaches the newest run's log tail on request", async () => {
    const provider = makeProvider({
      deployHistory: () => [record({})],
      readDeployLogTail: (file) => `tail of ${file}`,
    });
    const result = await toolByName(provider, "get_deploy_history").handler({
      projectId: "prj-1",
      limit: 20,
      includeLastRunLog: true,
    });
    const data = parsed(result) as { lastRunLog?: string };
    expect(data.lastRunLog).toBe("tail of /local/logs/shop/deploy-1.log");
  });
});

describe("start_deploy", () => {
  it("relays the provider's initial run state as-is", async () => {
    // The actual non-waiting lives in the desktop provider (startMcpRun);
    // the tool only relays the initial state the provider resolves with
    const startDeploy = vi.fn(async () => runningRun);
    const provider = makeProvider({ startDeploy });
    const result = await toolByName(provider, "start_deploy").handler({ projectId: "prj-1" });
    expect(result.isError).toBeUndefined();
    expect(startDeploy).toHaveBeenCalledWith(project);
    expect(parsed(result)).toMatchObject({ kind: "deploy", status: "running" });
  });

  it("relays the already-running refusal as a tool error", async () => {
    const provider = makeProvider({
      startDeploy: async () => {
        throw new Error("A deploy of this project is already running.");
      },
    });
    const result = await toolByName(provider, "start_deploy").handler({ projectId: "prj-1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already running");
  });

  it("rejects an unknown project id before reaching the provider", async () => {
    const startDeploy = vi.fn();
    const provider = makeProvider({
      startDeploy: startDeploy as unknown as McpProvider["startDeploy"],
    });
    const result = await toolByName(provider, "start_deploy").handler({ projectId: "nope" });
    expect(result.isError).toBe(true);
    expect(startDeploy).not.toHaveBeenCalled();
  });
});

describe("start_rollback", () => {
  it("returns the started run's state", async () => {
    const provider = makeProvider({
      startRollback: async () => ({ ...runningRun, kind: "rollback" as const }),
    });
    const result = await toolByName(provider, "start_rollback").handler({
      projectId: "prj-1",
    });
    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({ kind: "rollback", status: "running" });
  });

  it("relays the imported-project refusal as a tool error", async () => {
    const provider = makeProvider({
      startRollback: async () => {
        throw new Error(
          "An imported app keeps its versions in git — restore a version on the Versions tab.",
        );
      },
    });
    const result = await toolByName(provider, "start_rollback").handler({
      projectId: "prj-1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("imported app");
  });
});

describe("get_deploy_status", () => {
  it("returns a running run's state", async () => {
    const provider = makeProvider({ deployRunState: () => runningRun });
    const result = await toolByName(provider, "get_deploy_status").handler({
      projectId: "prj-1",
    });
    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({
      kind: "deploy",
      status: "running",
      lines: ["Updating the repository..."],
    });
  });

  it("returns a finished run with its result fields", async () => {
    const provider = makeProvider({
      deployRunState: () => ({
        ...runningRun,
        status: "error" as const,
        error: "npm install failed",
        errorCode: "npm-peer-conflict",
      }),
    });
    const result = await toolByName(provider, "get_deploy_status").handler({
      projectId: "prj-1",
    });
    expect(parsed(result)).toMatchObject({
      status: "error",
      error: "npm install failed",
      errorCode: "npm-peer-conflict",
    });
  });

  it("caps the log tail in the result", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    const provider = makeProvider({ deployRunState: () => ({ ...runningRun, lines }) });
    const result = await toolByName(provider, "get_deploy_status").handler({
      projectId: "prj-1",
    });
    const data = parsed(result) as { lines: string[] };
    expect(data.lines).toHaveLength(100);
    expect(data.lines.at(-1)).toBe("line 249");
  });

  it("answers with a readable error when the project has no runs", async () => {
    const provider = makeProvider({ deployRunState: () => null });
    const result = await toolByName(provider, "get_deploy_status").handler({
      projectId: "prj-1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No deploy runs of this project");
  });
});

describe("deploy toolset flag", () => {
  it("registers the mutating tools only when the provider allows deploys", () => {
    const names = (provider: McpProvider) => createTools(provider).map((tool) => tool.name);
    const off = names(makeProvider({ deploysAllowed: () => false }));
    expect(off).not.toContain("start_deploy");
    expect(off).not.toContain("start_rollback");
    // Watching a run is read-only — the status tool stays available
    expect(off).toContain("get_deploy_status");
    const on = names(makeProvider({ deploysAllowed: () => true }));
    expect(on).toContain("start_deploy");
    expect(on).toContain("start_rollback");
  });
});

describe("tool annotations", () => {
  it("marks the deploy tools destructive and everything else read-only", () => {
    for (const tool of createTools(makeProvider())) {
      if (tool.name === "start_deploy" || tool.name === "start_rollback") {
        expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
      } else {
        expect(tool.annotations).toEqual({ readOnlyHint: true });
      }
    }
  });
});
