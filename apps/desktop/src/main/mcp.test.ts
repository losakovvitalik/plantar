import type { AppSettings } from "@plantar/storage";
import { describe, expect, it } from "vitest";
import { ensureMcpToken } from "./mcp";

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
