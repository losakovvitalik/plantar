import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpProvider } from "./provider";
import { startMcpHttpServer, type McpHttpServerHandle } from "./http";

const TOKEN = "test-token-0123456789abcdef";

const provider: McpProvider = {
  listServers: () => [],
  listProjects: () => [],
  deployHistory: () => [],
  readDeployLogTail: () => "",
  withConnection: async () => {
    throw new Error("no SSH in this test");
  },
  projectRuntime: () => {
    throw new Error("no projects in this test");
  },
};

let server: McpHttpServerHandle;

beforeAll(async () => {
  server = await startMcpHttpServer({ provider, token: TOKEN, port: 0 });
});

afterAll(async () => {
  await server.close();
});

interface HttpReply {
  status: number;
  body: string;
}

function post(body: unknown, headers: Record<string, string>): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
};

describe("mcp http endpoint", () => {
  it("rejects a request without a token with 401", async () => {
    const reply = await post(initialize, {});
    expect(reply.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const reply = await post(initialize, { Authorization: "Bearer wrong" });
    expect(reply.status).toBe(401);
  });

  it("rejects a spoofed Host header with 403 (DNS rebinding)", async () => {
    const reply = await post(initialize, {
      Authorization: `Bearer ${TOKEN}`,
      Host: "evil.example",
    });
    expect(reply.status).toBe(403);
  });

  it("answers an initialize request with the server identity", async () => {
    const reply = await post(initialize, { Authorization: `Bearer ${TOKEN}` });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('"plantar"');
  });

  it("lists the read-only toolset", async () => {
    const reply = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { Authorization: `Bearer ${TOKEN}` },
    );
    expect(reply.status).toBe(200);
    for (const name of [
      "list_servers",
      "list_projects",
      "get_server_info",
      "get_app_status",
      "get_logs",
      "get_traffic_stats",
      "list_releases",
      "get_deploy_history",
      "discover_apps",
      "list_files",
    ]) {
      expect(reply.body).toContain(`"${name}"`);
    }
  });

  it("executes a tool call end to end", async () => {
    const reply = await post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_servers", arguments: {} },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    expect(reply.status).toBe(200);
    // The stub provider has no servers — the tool answers with an empty list
    expect(reply.body).toContain("[]");
  });
});
