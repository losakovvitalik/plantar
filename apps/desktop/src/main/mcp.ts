import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import {
  startMcpHttpServer,
  type McpHttpServerHandle,
  type McpProvider,
} from "@plantar/mcp";
import { MCP_PORT } from "@plantar/mcp/meta";
import type { AppSettings } from "@plantar/storage";

/**
 * Lifecycle of the local MCP endpoint: the listener runs only while the
 * settings toggle is on, and toggling applies without an app restart —
 * index.ts calls syncMcpServer on startup and on every settings save.
 */

/** Returns settings with an access token generated on first enable */
export function ensureMcpToken(settings: AppSettings): AppSettings {
  if (!settings.mcpServerEnabled || settings.mcpServerToken) return settings;
  return { ...settings, mcpServerToken: randomBytes(32).toString("hex") };
}

let handle: McpHttpServerHandle | null = null;

/** Serializes start/stop: a quick toggle off+on must not race the listener */
let queue: Promise<void> = Promise.resolve();

/**
 * Resolves to the port the listener is bound to, or null when it is not
 * running — the caller persists a fallback port so the address survives
 * restarts (#44).
 */
export function syncMcpServer(
  settings: AppSettings,
  provider: McpProvider,
): Promise<number | null> {
  const run = queue.then(() => apply(settings, provider));
  // The next sync must wait for this one even if it failed
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * Resolves the port the endpoint will actually use, without starting it:
 * the running listener's port when there is one; otherwise the saved/default
 * port when a test bind shows it is free, or null when it is taken — then
 * the real port is OS-assigned only on save (#44), so nothing is promised.
 * Goes through the queue so the probe never races a start/stop (#63).
 */
export function resolveMcpPort(savedPort: number): Promise<number | null> {
  const run = queue.then(() => probePort(savedPort || MCP_PORT));
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function probePort(port: number): Promise<number | null> {
  if (handle) return handle.port;
  // Same address the endpoint binds to (127.0.0.1), so the check matches;
  // the probe socket is closed right away — the listener starts only on save
  const free = await new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
  return free ? port : null;
}

async function apply(settings: AppSettings, provider: McpProvider): Promise<number | null> {
  if (!settings.mcpServerEnabled && handle) {
    const stopping = handle;
    handle = null;
    await stopping.close();
    return null;
  }
  if (settings.mcpServerEnabled && !handle && settings.mcpServerToken) {
    handle = await startMcpHttpServer({
      provider,
      token: settings.mcpServerToken,
      // The saved port comes first so the address stays stable; a bind
      // conflict (the port taken by another process) falls back to a free
      // port instead of leaving the user with no recourse (#44)
      port: settings.mcpServerPort || MCP_PORT,
      fallbackToFreePort: true,
    });
  }
  return handle?.port ?? null;
}
