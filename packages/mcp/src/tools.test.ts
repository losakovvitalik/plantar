import { beforeAll, describe, expect, it, vi } from "vitest";
import { setLanguage } from "@plantar/i18n";
import type { SshConnection } from "@plantar/ssh";
import type { DeployRecord, ProjectRecord, ServerRecord } from "@plantar/storage";
import type { McpProvider, ProjectRuntime } from "./provider";
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
    const conn = fakeConn((cmd) => {
      if (cmd.includes("/etc/os-release")) {
        return {
          stdout: 'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n',
        };
      }
      if (cmd.includes("nproc")) return { stdout: "2\n" };
      if (cmd.includes("MemTotal")) return { stdout: "MemTotal:  2048000 kB\n" };
      if (cmd.includes("df -k")) return { stdout: "10485760\n" };
      if (cmd.startsWith("node ")) return { stdout: "v22.0.0\n" };
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

  it("returns the project's records newest first without local log paths", async () => {
    const provider = makeProvider({
      deployHistory: () => [
        record({ startedAt: "2026-07-01T10:00:00.000Z" }),
        record({ project: "other", projectId: "prj-2" }),
        record({ startedAt: "2026-07-02T10:00:00.000Z", status: "error" }),
      ],
    });
    const result = await toolByName(provider, "get_deploy_history").handler({
      projectId: "prj-1",
      limit: 20,
      includeLastRunLog: false,
    });
    const data = parsed(result) as { records: Record<string, unknown>[]; lastRunLog?: string };
    expect(data.records).toHaveLength(2);
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
