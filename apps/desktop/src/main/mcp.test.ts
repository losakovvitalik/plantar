import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpProvider } from "@plantar/mcp";
import type { AppSettings } from "@plantar/storage";
import { afterEach, describe, expect, it } from "vitest";
import { ensureMcpToken, resolveMcpPort, syncMcpServer } from "./mcp";

const settings = (overrides: Partial<AppSettings>): AppSettings => ({
  saveServerLogCopies: true,
  letsEncryptEmail: "",
  notifyOnDeploySuccess: true,
  notifyOnAppDown: true,
  language: "ru",
  mcpServerEnabled: false,
  mcpServerToken: "",
  mcpServerPort: 0,
  mcpAllowDeploy: false,
  ...overrides,
});

describe("ensureMcpToken", () => {
  it("generates a token on first enable", () => {
    const result = ensureMcpToken(settings({ mcpServerEnabled: true }));
    // Same shape as the renderer-generated one: 32 random bytes as hex
    expect(result.mcpServerToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.mcpServerEnabled).toBe(true);
  });

  it("keeps an already-present token unchanged — the shown key equals the persisted one", () => {
    const input = settings({ mcpServerEnabled: true, mcpServerToken: "a".repeat(64) });
    const result = ensureMcpToken(input);
    expect(result).toBe(input);
    expect(result.mcpServerToken).toBe("a".repeat(64));
  });

  it("does not generate a token while access is disabled", () => {
    const input = settings({});
    expect(ensureMcpToken(input)).toBe(input);
  });
});

// The listener only binds a socket in these tests, the provider is never called
const provider = {} as McpProvider;

const enabled = (port: number): AppSettings =>
  settings({ mcpServerEnabled: true, mcpServerToken: "a".repeat(64), mcpServerPort: port });

/** Occupies a free port on 127.0.0.1 the way a foreign process would */
function occupyPort(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** A port that was just free — bind to 0, note the number, release it */
async function freePort(): Promise<number> {
  const holder = await occupyPort();
  await holder.close();
  return holder.port;
}

describe("resolveMcpPort", () => {
  afterEach(async () => {
    // Stop the listener a test may have started (module-level singleton)
    await syncMcpServer(settings({}), provider);
  });

  it("reports the saved port when it is free, and save then binds exactly that port", async () => {
    const port = await freePort();
    await expect(resolveMcpPort(port)).resolves.toBe(port);
    await expect(syncMcpServer(enabled(port), provider)).resolves.toBe(port);
  });

  it("reports null when the saved port is taken — save binds a different one", async () => {
    const blocker = await occupyPort();
    try {
      await expect(resolveMcpPort(blocker.port)).resolves.toBeNull();
      // The listener falls back to an OS-assigned port (#44), confirming the
      // probe was right not to promise the saved number
      const bound = await syncMcpServer(enabled(blocker.port), provider);
      expect(bound).not.toBeNull();
      expect(bound).not.toBe(blocker.port);
    } finally {
      await blocker.close();
    }
  });

  it("reports the running listener's port regardless of the saved one", async () => {
    const port = await freePort();
    const bound = await syncMcpServer(enabled(port), provider);
    // The saved port differs (say, edited elsewhere) — the live one wins
    await expect(resolveMcpPort(port + 1)).resolves.toBe(bound);
  });
});
