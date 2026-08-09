import { HostKeyRejectedError } from "@plantar/ssh";
import type { ServerRecord } from "@plantar/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MONITOR_CONFIRM_DELAY_MS,
  MONITOR_INTERVAL_MS,
  startAppMonitor,
  stopAppMonitor,
} from "./app-monitor";
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

const { notified } = vi.hoisted(() => ({
  notified: [] as { title: string; body: string }[],
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
  readSettings: () => ({ notifyOnAppDown: true }),
  readServers: () => [server],
  readProjects: () => [],
  // A fresh snapshot of the previous session is the baseline the monitor
  // starts from; without one the first observation is adopted silently
  readAppStatusCache: () => ({
    [server.id]: { apps: { p1: "running" }, checkedAt: new Date().toISOString() },
  }),
}));

afterEach(() => {
  stopAppMonitor();
  vi.useRealTimers();
  vi.restoreAllMocks();
  notified.length = 0;
});

describe("the background monitor on a changed host key", () => {
  it("warns about the identity instead of the server being down", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const collect = vi.fn();
    collect.mockRejectedValue(new HostKeyRejectedError(server.host, "SHA256:other"));
    startAppMonitor({ collectStatuses: collect, openFromBackground: () => {} });

    await vi.advanceTimersByTimeAsync(MONITOR_INTERVAL_MS);
    // Long enough for a suspected outage to be confirmed, had one been suspected
    await vi.advanceTimersByTimeAsync(MONITOR_CONFIRM_DELAY_MS);

    expect(notified).toEqual([
      {
        title: t("notifyIdentityChangedTitle"),
        body: t("notifyIdentityChangedBody", { name: server.name }),
      },
    ]);

    // Every sweep runs into the same key — the warning is not repeated
    await vi.advanceTimersByTimeAsync(MONITOR_INTERVAL_MS);
    expect(notified).toHaveLength(1);

    // The server was never recorded as fallen: a real outage after this is
    // still news, and would have been swallowed by a recorded fall
    collect.mockRejectedValue(new Error("Timed out while waiting for handshake"));
    await vi.advanceTimersByTimeAsync(MONITOR_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(MONITOR_CONFIRM_DELAY_MS);

    expect(notified).toContainEqual({
      title: t("notifyServerUnreachableTitle"),
      body: t("notifyServerUnreachableBody", { name: server.name }),
    });
  });
});
