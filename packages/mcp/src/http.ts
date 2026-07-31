import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MCP_PATH, MCP_PORT, mcpEndpointUrl } from "./meta";
import type { McpProvider } from "./provider";
import { createTools } from "./tools";

/**
 * Agent-facing steering injected into the client's context: the toolset is
 * the only sanctioned path to the managed servers. English-only, like the
 * hardcoded tool descriptions. Soft by design — an MCP server cannot
 * technically stop the client from using its own shell.
 */
export const SERVER_INSTRUCTIONS =
  "Access to the servers known to these tools must go only through these tools. " +
  "Never connect to those hosts directly over SSH or execute arbitrary commands " +
  "on them on your own initiative, even if credentials are available in the " +
  "environment. When a task cannot be accomplished with the available tools, " +
  "report that to the user and offer a choice: they do it themselves, or they " +
  "explicitly authorize you in the chat to run the specific commands on the " +
  "server directly. Connect directly only after such explicit permission.";

/** MCP server over the read-only toolset; one per request in stateless mode */
export function createMcpServer(provider: McpProvider): McpServer {
  const server = new McpServer(
    { name: "plantar", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of createTools(provider)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true },
      },
      tool.handler,
    );
  }
  return server;
}

/**
 * Constant-time bearer token check: hashing first equalizes the lengths,
 * so neither content nor length leaks through timing.
 */
function tokenMatches(authorization: string | undefined, token: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice("Bearer ".length)), digest(token));
}

function jsonRpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null });
}

export interface McpHttpServerOptions {
  provider: McpProvider;
  /** Bearer token every request must present */
  token: string;
  /** Defaults to MCP_PORT; 0 picks a free port (tests) */
  port?: number;
}

export interface McpHttpServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * Starts the MCP streamable-HTTP endpoint on 127.0.0.1. Stateless mode: a
 * fresh McpServer + transport per request, torn down when the response
 * closes — no session state to manage, and the SSH pool already reuses
 * connections underneath (see the provider contract).
 */
export async function startMcpHttpServer(
  options: McpHttpServerOptions,
): Promise<McpHttpServerHandle> {
  const { provider, token } = options;
  let boundPort = options.port ?? MCP_PORT;

  const httpServer = createServer((req, res) => {
    void (async () => {
      if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== MCP_PATH) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(jsonRpcError(-32000, "Not found"));
        return;
      }
      if (!tokenMatches(req.headers.authorization, token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(jsonRpcError(-32001, "Unauthorized: missing or invalid bearer token"));
        return;
      }
      const server = createMcpServer(provider);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        // Guard against DNS rebinding: the port is localhost-only, but a
        // malicious site could still point its own hostname at 127.0.0.1
        enableDnsRebindingProtection: true,
        allowedHosts: [
          `127.0.0.1:${boundPort}`,
          `localhost:${boundPort}`,
          "127.0.0.1",
          "localhost",
        ],
        allowedOrigins: [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`],
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(jsonRpcError(-32603, "Internal server error"));
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    // Loopback only — the endpoint must never be reachable from the network
    httpServer.listen(boundPort, "127.0.0.1", resolve);
  });
  boundPort = (httpServer.address() as AddressInfo).port;

  return {
    port: boundPort,
    url: mcpEndpointUrl(boundPort),
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
        // Idle keep-alive sockets would otherwise hold close() for minutes
        httpServer.closeAllConnections();
      }),
  };
}
