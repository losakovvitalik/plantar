import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { HostKeyRejectedError, SshConnection } from "./index";

interface FakeChannel extends EventEmitter {
  stderr: EventEmitter;
  end: () => void;
  close: () => void;
}

interface FakeClient extends EventEmitter {
  execCalls: Array<{ command: string; channel: FakeChannel }>;
  /** The config the code under test handed to ssh2 */
  config?: { hostVerifier?: (key: Buffer) => boolean };
}

// Replaces ssh2 with a fake whose exec() hands out inert channels the tests
// drive by emitting events. __clients exposes created clients to the tests,
// __hostKey is the key the fake server presents during the handshake.
vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");

  class Channel extends EventEmitter {
    stderr = new EventEmitter();
    end(): void {}
    close(): void {}
  }

  const clients: Client[] = [];
  const hostKey = Buffer.from("ssh-ed25519 fake host key");

  class Client extends EventEmitter {
    execCalls: Array<{ command: string; channel: Channel }> = [];
    config?: { hostVerifier?: (key: Buffer) => boolean };

    connect(config: { hostVerifier?: (key: Buffer) => boolean }): this {
      clients.push(this);
      this.config = config;
      queueMicrotask(() => {
        // Real ssh2 checks the host key during the key exchange — before
        // "ready" and before authentication; a turned-down key ends the
        // handshake with exactly this error
        if (config.hostVerifier?.(hostKey) === false) {
          this.emit("error", new Error("Host denied (verification failed)"));
          return;
        }
        this.emit("ready");
      });
      return this;
    }

    exec(command: string, cb: (err: undefined, stream: Channel) => void): boolean {
      const channel = new Channel();
      this.execCalls.push({ command, channel });
      cb(undefined, channel);
      return true;
    }

    end(): void {}
  }

  return { Client, __clients: clients, __hostKey: hostKey };
});

function ssh2Mock(): Promise<{ __clients: FakeClient[]; __hostKey: Buffer }> {
  return import("ssh2") as unknown as Promise<{
    __clients: FakeClient[];
    __hostKey: Buffer;
  }>;
}

/** The fingerprint of the fake server's key, computed the way OpenSSH does */
async function hostFingerprint(): Promise<string> {
  const { __hostKey } = await ssh2Mock();
  return `SHA256:${createHash("sha256").update(__hostKey).digest("base64").replace(/=+$/, "")}`;
}

async function connect(): Promise<{ conn: SshConnection; client: FakeClient }> {
  const { __clients } = await ssh2Mock();
  const conn = await SshConnection.connect({
    host: "test",
    username: "u",
    password: "p",
    verifyHostKey: () => true,
  });
  const client = __clients.at(-1);
  if (!client) throw new Error("mock client was not created");
  return { conn, client };
}

/** Waits until the client has received exec call #index and returns it */
async function execCall(
  client: FakeClient,
  index: number,
): Promise<{ command: string; channel: FakeChannel }> {
  await vi.waitFor(() => {
    if (client.execCalls.length <= index) throw new Error("exec call not made yet");
  });
  return client.execCalls[index];
}

/** The first exec on a connection is the PATH detection probe — finish it empty */
async function finishPathProbe(client: FakeClient): Promise<void> {
  (await execCall(client, 0)).channel.emit("close", 0);
}

describe("connect errors", () => {
  it("names the server and the user and keeps the ssh2 reason", async () => {
    const { __clients } = await ssh2Mock();
    const pending = SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: () => true,
    });
    const client = __clients.at(-1);
    if (!client) throw new Error("mock client was not created");
    const reason = new Error("All configured authentication methods failed");
    client.emit("error", reason);
    const err = await pending.then(
      () => {
        throw new Error("connect resolved instead of rejecting");
      },
      (e: Error) => e,
    );
    // The exact wording is localized; the facts must be present in any language
    expect(err.message).toContain("h.example");
    expect(err.message).toContain("deploy");
    expect(err.message).toContain("All configured authentication methods failed");
    expect(err.cause).toBe(reason);
  });

  it("wraps synchronous throws (unreadable key file) the same way", async () => {
    // readFileSync throws ENOENT inside the executor, before any "error" event
    const pending = SshConnection.connect({
      host: "h.example",
      username: "deploy",
      privateKeyPath: "/nonexistent/plantar-test-key",
      verifyHostKey: () => true,
    });
    const err = await pending.then(
      () => {
        throw new Error("connect resolved instead of rejecting");
      },
      (e: Error) => e,
    );
    expect(err.message).toContain("h.example");
    expect(err.message).toContain("deploy");
    expect(err.message).toContain("ENOENT");
    expect((err.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});

describe("host key verification", () => {
  it("always hands ssh2 a verifier, so no key is accepted by default", async () => {
    const { client } = await connect();
    expect(typeof client.config?.hostVerifier).toBe("function");
  });

  it("connects when the fingerprint matches and reports it on the connection", async () => {
    const fingerprint = await hostFingerprint();
    const seen: string[] = [];
    const conn = await SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: (fp) => {
        seen.push(fp);
        return fp === fingerprint;
      },
    });
    // The verifier is asked with the OpenSSH form of the key the server sent
    expect(seen).toEqual([fingerprint]);
    expect(conn.hostKeyFingerprint).toBe(fingerprint);
  });

  it("fails with its own error when the fingerprint is not the expected one", async () => {
    const fingerprint = await hostFingerprint();
    const pending = SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: (fp) => fp === "SHA256:the-key-this-server-used-to-have",
    });
    const err = await pending.then(
      () => {
        throw new Error("connect resolved instead of rejecting");
      },
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(HostKeyRejectedError);
    const rejection = err as HostKeyRejectedError;
    // The code is what the UI keys off to tell this apart from a failed connect
    expect(rejection.code).toBe("host-key-rejected");
    expect(rejection.host).toBe("h.example");
    expect(rejection.fingerprint).toBe(fingerprint);
    // Not folded into the generic "could not connect" wrapper
    expect(rejection.message).not.toContain("Host denied");
  });
});

describe("exec channel errors", () => {
  it("rejects the command when the channel emits an error", async () => {
    const { conn, client } = await connect();
    const result = conn.exec("systemctl status nginx");
    await finishPathProbe(client);
    const { channel } = await execCall(client, 1);
    const failure = new Error("channel failure");
    channel.emit("error", failure);
    await expect(result).rejects.toBe(failure);
  });

  it("ignores a late error after close instead of crashing", async () => {
    const { conn, client } = await connect();
    const result = conn.exec("echo ok");
    await finishPathProbe(client);
    const { channel } = await execCall(client, 1);
    channel.emit("data", Buffer.from("ok"));
    channel.emit("close", 0);
    // Without a listener this emit would throw ERR_UNHANDLED_ERROR
    expect(() => channel.emit("error", new Error("late transport error"))).not.toThrow();
    await expect(result).resolves.toEqual({ stdout: "ok", stderr: "", code: 0 });
  });
});

describe("execStream channel errors", () => {
  it("turns a channel error into a single onClose, not a crash", async () => {
    const { conn, client } = await connect();
    const onStderr = vi.fn();
    const onClose = vi.fn();
    const handle = conn.execStream("tail -F /var/log/nginx/access.log", {
      onStdout: () => {},
      onStderr,
      onClose,
    });
    await finishPathProbe(client);
    const { channel } = await execCall(client, 1);
    await handle;
    expect(() => channel.emit("error", new Error("transport lost"))).not.toThrow();
    // The reason is forwarded so consumers can show why the stream ended
    expect(onStderr).toHaveBeenCalledWith("transport lost");
    expect(onClose).toHaveBeenCalledTimes(1);
    // A close following the error must not fire onClose a second time
    channel.emit("close");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
