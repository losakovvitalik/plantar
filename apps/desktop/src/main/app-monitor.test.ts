import type { ServerRecord } from "@plantar/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "./i18n";

const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "key",
  hostKeyFingerprint: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const { notified, settings } = vi.hoisted(() => ({
  notified: [] as { title: string; body: string }[],
  settings: { notifyOnAppDown: true },
}));

vi.mock("electron", () => {
  class FakeNotification {
    static isSupported = (): boolean => true;
    constructor(options: { title: string; body: string }) {
      notified.push(options);
    }
    on(): void {}
    show(): void {}
  }
  return {
    Notification: FakeNotification,
    net: { isOnline: () => true },
    powerMonitor: { on: () => {} },
    // No window: the app is closed to the tray, the case the background
    // monitor exists for — the identity event has nowhere to go
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    ipcMain: { handle: () => {} },
  };
});

vi.mock("@plantar/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plantar/storage")>()),
  readSettings: () => settings,
  readServers: () => [server],
  readProjects: () => [],
  // A fresh snapshot of the previous session is the baseline the monitor
  // starts from; without one the first observation is adopted silently
  readAppStatusCache: () => ({
    [server.id]: { apps: { p1: "running" }, checkedAt: new Date().toISOString() },
  }),
}));

// The monitor and the identity it reports to live in module state, and stopping
// the monitor is final — each test needs its own copy of both
let monitor: typeof import("./app-monitor");
// From the same fresh copy: the monitor recognises a rejected host key by
// instanceof, and after the reset a class imported at the top of this file is
// no longer the class it checks against
let ssh: typeof import("@plantar/ssh");
// The same copy the monitor talks to — the collector below reports the changed
// identity through it, as the real connection does
let identity: typeof import("./server-identity");

beforeEach(async () => {
  vi.resetModules();
  monitor = await import("./app-monitor");
  ssh = await import("@plantar/ssh");
  identity = await import("./server-identity");
});

afterEach(() => {
  monitor.stopAppMonitor();
  settings.notifyOnAppDown = true;
  vi.useRealTimers();
  vi.restoreAllMocks();
  notified.length = 0;
});

describe("the background monitor on a changed host key", () => {
  it("warns about the identity instead of the server being down", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const collect = vi.fn();
    // As the real collector fails: it connects through connections.ts, which
    // records the changed identity itself and only then lets the error out. A
    // bare rejection would test the monitor's branch without the wiring it runs
    // in — and the fact reaching the monitor as old news is exactly the case
    // that once left the user with nothing said
    collect.mockImplementation(() => {
      identity.reportIdentityChanged(server.id, "SHA256:other");
      return Promise.reject(new ssh.HostKeyRejectedError(server.host, "SHA256:other"));
    });
    monitor.startAppMonitor({ collectStatuses: collect, openFromBackground: () => {} });

    await vi.advanceTimersByTimeAsync(monitor.MONITOR_INTERVAL_MS);
    // Long enough for a suspected outage to be confirmed, had one been suspected
    await vi.advanceTimersByTimeAsync(monitor.MONITOR_CONFIRM_DELAY_MS);

    expect(notified).toEqual([
      {
        title: t("notifyIdentityChangedTitle"),
        body: t("notifyIdentityChangedBody", { name: server.name }),
      },
    ]);

    // Every sweep runs into the same key — the warning is not repeated
    await vi.advanceTimersByTimeAsync(monitor.MONITOR_INTERVAL_MS);
    expect(notified).toHaveLength(1);

    // The server was never recorded as fallen: a real outage after this is
    // still news, and would have been swallowed by a recorded fall
    collect.mockRejectedValue(new Error("Timed out while waiting for handshake"));
    await vi.advanceTimersByTimeAsync(monitor.MONITOR_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(monitor.MONITOR_CONFIRM_DELAY_MS);

    expect(notified).toContainEqual({
      title: t("notifyServerUnreachableTitle"),
      body: t("notifyServerUnreachableBody", { name: server.name }),
    });
  });

  it("warns again about a second change after a settle it never saw", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const collect = vi.fn().mockImplementation(() => {
      identity.reportIdentityChanged(server.id, "SHA256:other");
      return Promise.reject(new ssh.HostKeyRejectedError(server.host, "SHA256:other"));
    });
    monitor.startAppMonitor({ collectStatuses: collect, openFromBackground: () => {} });

    await vi.advanceTimersByTimeAsync(monitor.MONITOR_INTERVAL_MS);
    expect(notified).toHaveLength(1);

    // A successful foreground connection settled the episode (connections.ts
    // calls this); no sweep of the monitor's own succeeded in between
    identity.clearIdentityChanged(server.id);

    // The key changes again before the next successful sweep — with the window
    // closed this notification is the only thing the user is ever told
    await vi.advanceTimersByTimeAsync(monitor.MONITOR_INTERVAL_MS);
    expect(notified).toHaveLength(2);
  });

  it("does not go looking for it with background watching switched off", async () => {
    // notifyOnAppDown switches background monitoring off, so no sweep runs and
    // nothing connects: going to the server on its own for a user who turned
    // that off is what the app must never do. The changed key then waits for
    // the next operation the user starts, which reports it itself
    settings.notifyOnAppDown = false;
    vi.useFakeTimers();
    const collect = vi
      .fn()
      .mockRejectedValue(new ssh.HostKeyRejectedError(server.host, "SHA256:other"));
    monitor.startAppMonitor({ collectStatuses: collect, openFromBackground: () => {} });

    await vi.advanceTimersByTimeAsync(monitor.MONITOR_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(monitor.MONITOR_CONFIRM_DELAY_MS);

    expect(collect).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });
});
