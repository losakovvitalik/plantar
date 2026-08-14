import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearIdentityChanged,
  identityChangedServers,
  reportIdentityChanged,
  shouldWarnIdentityChanged,
} from "./server-identity";

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
    expect(reportIdentityChanged("s1")).toBe(true);

    expect(send).not.toHaveBeenCalled();
    expect(identityChangedServers()).toEqual(["s1"]);
  });

  it("tells an open window about it", () => {
    openWindow();

    reportIdentityChanged("s1");

    expect(send).toHaveBeenCalledWith("server:identity-changed", { serverId: "s1" });
  });

  it("reports the fact as news only once", () => {
    // The monitor sweeps every few minutes; a warning every time would be noise
    openWindow();

    expect(reportIdentityChanged("s1")).toBe(true);
    expect(reportIdentityChanged("s1")).toBe(false);
    // The event is held to the same rule: the window already has this server on
    // its list, and hearing it again on every sweep tells it nothing new
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is news again after the server proved its key", () => {
    reportIdentityChanged("s1");

    clearIdentityChanged("s1");

    expect(identityChangedServers()).toEqual([]);
    expect(reportIdentityChanged("s1")).toBe(true);
  });
});

describe("shouldWarnIdentityChanged", () => {
  it("warns once per episode", () => {
    reportIdentityChanged("s1");

    expect(shouldWarnIdentityChanged("s1")).toBe(true);
    // The monitor asks on every sweep — the answer must not repeat the warning
    expect(shouldWarnIdentityChanged("s1")).toBe(false);
  });

  it("does not warn about a server whose identity is not in question", () => {
    expect(shouldWarnIdentityChanged("s1")).toBe(false);
  });

  it("warns again about a second change after the question was settled", () => {
    reportIdentityChanged("s1");
    shouldWarnIdentityChanged("s1");
    // A successful foreground connection settles the episode (connections.ts) —
    // the warning must re-arm here, not wait for a successful sweep
    clearIdentityChanged("s1");

    reportIdentityChanged("s1");

    expect(shouldWarnIdentityChanged("s1")).toBe(true);
  });
});
