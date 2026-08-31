import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HostKey } from "@plantar/ssh";
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

const KEY: HostKey = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
const NEW_KEY: HostKey = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};
const THIRD_KEY: HostKey = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:ccccccccccccccccccccccccccccccccccccccccccc",
};

const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "key",
  hostKeys: [KEY],
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

type PresentedHandler = (
  event: unknown,
  serverId: string,
) => Promise<IpcResult<HostKey | null>>;

function invokePresented(serverId: string): Promise<IpcResult<HostKey | null>> {
  const handler = handlers.get("servers:presentedHostKey") as PresentedHandler | undefined;
  if (!handler) throw new Error("servers:presentedHostKey handler was not registered");
  return handler({}, serverId);
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

describe("servers:presentedHostKey", () => {
  it("hands the window the type along with the fingerprint", async () => {
    // The type is what tells the user which line of the control panel — one per
    // key type — the fingerprint on screen is supposed to match
    reportIdentityChanged(server.id, NEW_KEY);

    await expect(invokePresented(server.id)).resolves.toEqual({
      ok: true,
      data: NEW_KEY,
    });
  });

  it("answers with nothing once the question is settled", async () => {
    // A connection that succeeded settled the question while the confirmation
    // was open: there is no key left to offer, and the dialog says so instead
    // of showing the one it asked about
    reportIdentityChanged(server.id, NEW_KEY);
    clearIdentityChanged(server.id);

    await expect(invokePresented(server.id)).resolves.toEqual({
      ok: true,
      data: null,
    });
  });
});

describe("servers:trustHostKey", () => {
  it("records the key the user was shown and settles the question", async () => {
    reportIdentityChanged(server.id, NEW_KEY);

    await expect(
      invokeTrust({ serverId: server.id, fingerprint: NEW_KEY.fingerprint }),
    ).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    // Recorded with the type of the key that was shown, not just its fingerprint
    expect(readServers()[0].hostKeys).toEqual([NEW_KEY]);
    // The server is no longer in question — the sidebar leaves that state
    expect(identityChangedServers()).toEqual([]);
  });

  it("turns down a key the server no longer answers with", async () => {
    // The confirmation stayed open while the server moved on to yet another
    // key: recording what is on screen would pin a key nobody was shown
    reportIdentityChanged(server.id, NEW_KEY);
    reportIdentityChanged(server.id, THIRD_KEY);

    await expect(
      invokeTrust({ serverId: server.id, fingerprint: NEW_KEY.fingerprint }),
    ).resolves.toEqual({
      ok: false,
      error: t("hostKeyNoLongerPresented"),
      code: undefined,
    });

    expect(readServers()[0].hostKeys).toEqual([KEY]);
    expect(identityChangedServers()).toEqual([server.id]);
  });

  it("turns down a server whose identity is not in question", async () => {
    // Settled by a connection that presented the recorded key while the
    // confirmation was open: nothing was shown, so nothing may be recorded
    await expect(
      invokeTrust({ serverId: server.id, fingerprint: NEW_KEY.fingerprint }),
    ).resolves.toEqual({
      ok: false,
      error: t("hostKeyNoLongerPresented"),
      code: undefined,
    });

    expect(readServers()[0].hostKeys).toEqual([KEY]);
  });
});
