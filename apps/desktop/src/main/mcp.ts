import { randomBytes } from "node:crypto";
import {
  startMcpHttpServer,
  type McpHttpServerHandle,
  type McpProvider,
} from "@plantar/mcp";
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

export function syncMcpServer(settings: AppSettings, provider: McpProvider): Promise<void> {
  const run = queue.then(() => apply(settings, provider));
  // The next sync must wait for this one even if it failed
  queue = run.catch(() => {});
  return run;
}

async function apply(settings: AppSettings, provider: McpProvider): Promise<void> {
  if (!settings.mcpServerEnabled && handle) {
    const stopping = handle;
    handle = null;
    await stopping.close();
    return;
  }
  if (settings.mcpServerEnabled && !handle && settings.mcpServerToken) {
    handle = await startMcpHttpServer({ provider, token: settings.mcpServerToken });
  }
}
