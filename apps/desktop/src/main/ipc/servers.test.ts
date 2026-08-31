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

const { handlers, send, windows } = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  send: vi.fn(),
  windows: [] as { isDestroyed: () => boolean; webContents: { send: unknown } }[],
}));

// Only the registry is faked: the handler under test writes through the real
// host-key store and reads the real list of identities in question, so the
// check between them is exercised and not stubbed out. The window list stays
// empty unless a test opens one, and then the real activeWindow()/sendToWindow
// pair runs — so the test sees the events the renderer subscribes to
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      handlers.set(channel, fn);
    },
  },
  app: { getPath: () => "" },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  BrowserWindow: {
    getFocusedWindow: () => windows[0] ?? null,
    getAllWindows: () => windows,
  },
}));

registerServersIpc();

const openWindow = (): void => {
  windows.push({ isDestroyed: () => false, webContents: { send } });
};

interface TrustArgs {
  serverId: string;
  fingerprint: string;
}

type Handler<A> = (event: unknown, args: A) => Promise<IpcResult<void>>;

function invokeTrust(args: TrustArgs): Promise<IpcResult<void>> {
  const handler = handlers.get("servers:trustHostKey") as Handler<TrustArgs> | undefined;
  if (!handler) throw new Error("servers:trustHostKey handler was not registered");
  return handler({}, args);
}

function invokeRemove(id: string): Promise<IpcResult<void>> {
  const handler = handlers.get("servers:remove") as Handler<string> | undefined;
  if (!handler) throw new Error("servers:remove handler was not registered");
  return handler({}, id);
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
  // Emptied before the drain below: draining a server still in question
  // announces the settle, and a window a test left open would take that event
  // into the send spy instead of nowhere
  windows.length = 0;
  for (const id of identityChangedServers()) clearIdentityChanged(id);
  send.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("servers:remove", () => {
  it("drops the identity question without announcing it as settled", async () => {
    // The question is discarded with the record, not answered. A settle would
    // reach the renderer before this call resolves, while it still holds the
    // pre-removal list: every remaining server would blink into the checking
    // state and the deleted one would be asked for its app statuses
    reportIdentityChanged(server.id, NEW_KEY);
    openWindow();

    await expect(invokeRemove(server.id)).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    expect(identityChangedServers()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("servers:trustHostKey", () => {
  it("records the key the user was shown and settles the question", async () => {
    // The window opens after the fact, so the only event it can see is the
    // settle one. Without it the warning stays on screen next to a server that
    // is trusted again: confirming the key refreshes no status
    reportIdentityChanged(server.id, NEW_KEY);
    openWindow();

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
    expect(send).toHaveBeenCalledWith("server:identity-settled", { serverId: server.id });
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
