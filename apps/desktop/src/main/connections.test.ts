import { HostKeyRejectedError } from "@plantar/ssh";
import type { ServerRecord } from "@plantar/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "./connections";
import { clearIdentityChanged, identityChangedServers } from "./server-identity";

const KEY = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const { send, sshConnect, rememberHostKey } = vi.hoisted(() => ({
  send: vi.fn(),
  sshConnect: vi.fn(),
  rememberHostKey: vi.fn(),
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

// Only the store write is faked; the verifier next to it stays real
vi.mock("./host-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host-keys")>()),
  rememberHostKey,
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
  hostKeys: [KEY],
};

afterEach(() => {
  vi.clearAllMocks();
  // The identity list is module state shared by every test here — drain it so
  // no test depends on what the previous one left in it
  for (const id of identityChangedServers()) clearIdentityChanged(id);
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
    sshConnect.mockResolvedValue({ hostKey: KEY });

    await connect(server, "secret");

    expect(send).not.toHaveBeenCalled();
  });

  it("asks for the recorded key types first", async () => {
    // The half of the policy that lives at the connect site: a server that has
    // gained a key of another type keeps answering with the recorded one, which
    // is what lets the verifier turn down every type it has nothing on
    sshConnect.mockResolvedValue({ hostKey: KEY });

    await connect(server, "secret");

    expect(sshConnect).toHaveBeenCalledWith(
      expect.objectContaining({ knownHostKeyTypes: ["ssh-ed25519"] }),
    );
  });

  it("forgets a changed identity once the server proves its key again", async () => {
    // Kept in main so a window opening later still learns about it — which
    // means it also has to be dropped there, or the warning outlives its reason
    sshConnect.mockRejectedValueOnce(new HostKeyRejectedError(server.host, KEY));
    await expect(connect(server, "secret")).rejects.toBeInstanceOf(HostKeyRejectedError);
    expect(identityChangedServers()).toEqual(["s1"]);

    sshConnect.mockResolvedValue({ hostKey: KEY });
    await connect(server, "secret");

    expect(identityChangedServers()).toEqual([]);
  });

  it("keeps the connection when the host key cannot be recorded", async () => {
    // Storage writes throw (a full disk, a read-only home). Letting that out
    // would drop the only reference to a connection that is already open
    sshConnect.mockResolvedValue({ hostKey: KEY });
    rememberHostKey.mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const conn = await connect({ ...server, hostKeys: undefined }, "secret");

    expect(conn).toEqual({ hostKey: KEY });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
