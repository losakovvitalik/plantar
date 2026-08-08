import { HostKeyRejectedError } from "@plantar/ssh";
import type { ServerRecord } from "@plantar/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "./connections";

const KEY = "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const { send, sshConnect } = vi.hoisted(() => ({
  send: vi.fn(),
  sshConnect: vi.fn(),
}));

// One live window, so the real activeWindow()/sendToWindow pair runs and the
// test sees the channel and payload the renderer actually subscribes to
vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
  },
  ipcMain: { handle: () => {} },
}));

vi.mock("@plantar/ssh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plantar/ssh")>()),
  SshConnection: { connect: sshConnect },
}));

// Password auth and a key already on record: nothing here reads a key file
// or writes to the store, the connection attempt is all that matters
const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "password",
  hostKeyFingerprint: KEY,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("connect", () => {
  it("tells the window the identity changed when the host key is turned down", async () => {
    // A password server is never swept silently, so the failed operation is
    // the only thing that can put the app into that state
    sshConnect.mockRejectedValue(new HostKeyRejectedError(server.host, KEY));

    await expect(connect(server, "secret")).rejects.toBeInstanceOf(HostKeyRejectedError);

    expect(send).toHaveBeenCalledWith("server:identity-changed", { serverId: "s1" });
  });

  it("says nothing about the identity when the connection fails for another reason", async () => {
    sshConnect.mockRejectedValue(new Error("All configured authentication methods failed"));

    await expect(connect(server, "secret")).rejects.toThrow(/authentication/);

    expect(send).not.toHaveBeenCalled();
  });

  it("says nothing about the identity when the connection succeeds", async () => {
    sshConnect.mockResolvedValue({ hostKeyFingerprint: KEY });

    await connect(server, "secret");

    expect(send).not.toHaveBeenCalled();
  });
});
