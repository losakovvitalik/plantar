import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ServerRecord, readServers, writeServers } from "@plantar/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../shared/ipc";
import { t } from "../i18n";
import {
  clearIdentityChanged,
  identityChangedServers,
  reportIdentityChanged,
} from "../server-identity";
import { registerServersIpc } from "./servers";

const KEY = "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_KEY = "SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const THIRD_KEY = "SHA256:ccccccccccccccccccccccccccccccccccccccccccc";

const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "key",
  hostKeyFingerprint: KEY,
};

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, unknown>() }));

// Only the registry is faked: the handler under test writes through the real
// host-key store and reads the real list of identities in question, so the
// check between them is exercised and not stubbed out
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      handlers.set(channel, fn);
    },
  },
  app: { getPath: () => "" },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

registerServersIpc();

interface TrustArgs {
  serverId: string;
  fingerprint: string;
}

type Handler = (event: unknown, args: TrustArgs) => Promise<IpcResult<void>>;

function invokeTrust(args: TrustArgs): Promise<IpcResult<void>> {
  const handler = handlers.get("servers:trustHostKey") as Handler | undefined;
  if (!handler) throw new Error("servers:trustHostKey handler was not registered");
  return handler({}, args);
}

let tmpHome: string;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-servers-ipc-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));
  writeServers([server]);
});

afterEach(() => {
  for (const id of identityChangedServers()) clearIdentityChanged(id);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("servers:trustHostKey", () => {
  it("records the key the user was shown and settles the question", async () => {
    reportIdentityChanged(server.id, NEW_KEY);

    await expect(invokeTrust({ serverId: server.id, fingerprint: NEW_KEY })).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    expect(readServers()[0].hostKeyFingerprint).toBe(NEW_KEY);
    // The server is no longer in question — the sidebar leaves that state
    expect(identityChangedServers()).toEqual([]);
  });

  it("turns down a key the server no longer answers with", async () => {
    // The confirmation stayed open while the server moved on to yet another
    // key: recording what is on screen would pin a key nobody was shown
    reportIdentityChanged(server.id, NEW_KEY);
    reportIdentityChanged(server.id, THIRD_KEY);

    await expect(invokeTrust({ serverId: server.id, fingerprint: NEW_KEY })).resolves.toEqual({
      ok: false,
      error: t("hostKeyNoLongerPresented"),
      code: undefined,
    });

    expect(readServers()[0].hostKeyFingerprint).toBe(KEY);
    expect(identityChangedServers()).toEqual([server.id]);
  });

  it("turns down a server whose identity is not in question", async () => {
    // Settled by a connection that presented the recorded key while the
    // confirmation was open: nothing was shown, so nothing may be recorded
    await expect(invokeTrust({ serverId: server.id, fingerprint: NEW_KEY })).resolves.toEqual({
      ok: false,
      error: t("hostKeyNoLongerPresented"),
      code: undefined,
    });

    expect(readServers()[0].hostKeyFingerprint).toBe(KEY);
  });
});
