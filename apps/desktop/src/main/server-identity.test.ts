import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearIdentityChanged,
  identityChangedServers,
  presentedHostKey,
  reportIdentityChanged,
  shouldWarnIdentityChanged,
} from "./server-identity";

const KEY = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
const OTHER_KEY = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

const { send, windows } = vi.hoisted(() => ({
  send: vi.fn(),
  windows: [] as { isDestroyed: () => boolean; webContents: { send: unknown } }[],
}));

// The real activeWindow()/sendToWindow pair runs, so the test sees the channel
// and payload the renderer subscribes to; an empty windows list is the app
// closed to the tray — the case the list below exists for
vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => windows[0] ?? null,
    getAllWindows: () => windows,
  },
  ipcMain: { handle: () => {} },
}));

const openWindow = (): void => {
  windows.push({ isDestroyed: () => false, webContents: { send } });
};

afterEach(() => {
  for (const id of identityChangedServers()) clearIdentityChanged(id);
  windows.length = 0;
  vi.clearAllMocks();
});

describe("reportIdentityChanged", () => {
  it("keeps the fact for a window that opens later", () => {
    // Found by the background monitor with the app closed to the tray: there
    // is nothing to send the event to, and the warning would be lost
    expect(reportIdentityChanged("s1", KEY)).toBe(true);

    expect(send).not.toHaveBeenCalled();
    expect(identityChangedServers()).toEqual(["s1"]);
  });

  it("tells an open window about it", () => {
    openWindow();

    reportIdentityChanged("s1", KEY);

    expect(send).toHaveBeenCalledWith("server:identity-changed", { serverId: "s1" });
  });

  it("reports the fact as news only once", () => {
    // The monitor sweeps every few minutes; a warning every time would be noise
    openWindow();

    expect(reportIdentityChanged("s1", KEY)).toBe(true);
    expect(reportIdentityChanged("s1", KEY)).toBe(false);
    // The event is held to the same rule: the window already has this server on
    // its list, and hearing it again on every sweep tells it nothing new
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is news again after the server proved its key", () => {
    reportIdentityChanged("s1", KEY);

    clearIdentityChanged("s1");

    expect(identityChangedServers()).toEqual([]);
    expect(reportIdentityChanged("s1", KEY)).toBe(true);
  });
});

describe("presentedHostKey", () => {
  it("keeps the key the server answered with", () => {
    // The rejected handshake is the only place this key is seen: offering to
    // record it must not need a connection to a server the app is refusing
    reportIdentityChanged("s1", KEY);

    expect(presentedHostKey("s1")).toEqual(KEY);
  });

  it("keeps the key of the latest attempt", () => {
    // The fact is old news by then, but what the user is shown to confirm has
    // to be what the server answers with now
    reportIdentityChanged("s1", KEY);

    reportIdentityChanged("s1", OTHER_KEY);

    expect(presentedHostKey("s1")).toEqual(OTHER_KEY);
  });

  it("has no key for a server whose identity is not in question", () => {
    reportIdentityChanged("s1", KEY);

    clearIdentityChanged("s1");

    expect(presentedHostKey("s1")).toBeUndefined();
    expect(presentedHostKey("s2")).toBeUndefined();
  });
});

describe("shouldWarnIdentityChanged", () => {
  it("warns once per episode", () => {
    reportIdentityChanged("s1", KEY);

    expect(shouldWarnIdentityChanged("s1")).toBe(true);
    // The monitor asks on every sweep — the answer must not repeat the warning
    expect(shouldWarnIdentityChanged("s1")).toBe(false);
  });

  it("does not warn about a server whose identity is not in question", () => {
    expect(shouldWarnIdentityChanged("s1")).toBe(false);
  });

  it("warns again about a second change after the question was settled", () => {
    reportIdentityChanged("s1", KEY);
    shouldWarnIdentityChanged("s1");
    // A successful foreground connection settles the episode (connections.ts) —
    // the warning must re-arm here, not wait for a successful sweep
    clearIdentityChanged("s1");

    reportIdentityChanged("s1", KEY);

    expect(shouldWarnIdentityChanged("s1")).toBe(true);
  });
});
