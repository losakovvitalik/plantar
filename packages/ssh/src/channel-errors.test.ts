import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HostKey, HostKeyRejectedError, SshConnection } from "./index";

interface FakeChannel extends EventEmitter {
  stderr: EventEmitter;
  end: () => void;
  close: () => void;
}

/** The part of the ssh2 config these tests look at */
interface FakeConfig {
  hostVerifier?: (key: Buffer) => boolean;
  algorithms?: { serverHostKey?: string[] };
}

interface FakeClient extends EventEmitter {
  execCalls: Array<{ command: string; channel: FakeChannel }>;
  /** The config the code under test handed to ssh2 */
  config?: FakeConfig;
}

// Replaces ssh2 with a fake whose exec() hands out inert channels the tests
// drive by emitting events. __clients exposes created clients to the tests,
// __hostKeys are the keys the fake server holds and __presentHostKey picks the
// one it presents during the handshake — a real server holds one key per type
// and the handshake settles on one of them.
vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");

  class Channel extends EventEmitter {
    stderr = new EventEmitter();
    end(): void {}
    close(): void {}
  }

  const clients: Client[] = [];
  // A host key travels in the SSH wire format: the algorithm name as a
  // length-prefixed string, then the key material. The type is read out of
  // that first field, so the fake keys carry a real one
  const wireKey = (type: string, material: string): Buffer => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(name.length);
    return Buffer.concat([length, name, Buffer.from(material)]);
  };
  const hostKeys = {
    ed25519: wireKey("ssh-ed25519", "fake ed25519 host key"),
    rsa: wireKey("ssh-rsa", "fake rsa host key"),
  };
  let presented = hostKeys.ed25519;

  class Client extends EventEmitter {
    execCalls: Array<{ command: string; channel: Channel }> = [];
    config?: FakeConfig;

    connect(config: FakeConfig): this {
      clients.push(this);
      this.config = config;
      queueMicrotask(() => {
        // Real ssh2 checks the host key during the key exchange — before
        // "ready" and before authentication; a turned-down key ends the
        // handshake with exactly this error
        if (config.hostVerifier?.(presented) === false) {
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

  return {
    Client,
    __clients: clients,
    __hostKeys: hostKeys,
    __presentHostKey: (key: Buffer) => {
      presented = key;
    },
  };
});

interface Ssh2Mock {
  __clients: FakeClient[];
  __hostKeys: { ed25519: Buffer; rsa: Buffer };
  __presentHostKey: (key: Buffer) => void;
}

function ssh2Mock(): Promise<Ssh2Mock> {
  return import("ssh2") as unknown as Promise<Ssh2Mock>;
}

/** The fingerprint of a key, computed the way OpenSSH does */
function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/** The key the fake server presents unless a test moves it */
async function hostFingerprint(): Promise<string> {
  const { __hostKeys } = await ssh2Mock();
  return fingerprintOf(__hostKeys.ed25519);
}

// A test that made the server present another key must not leave it that way
afterEach(async () => {
  const { __hostKeys, __presentHostKey } = await ssh2Mock();
  __presentHostKey(__hostKeys.ed25519);
});

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

  it("connects when the key matches and reports it on the connection", async () => {
    const fingerprint = await hostFingerprint();
    const seen: HostKey[] = [];
    const conn = await SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: (key) => {
        seen.push(key);
        return key.fingerprint === fingerprint;
      },
    });
    // The verifier is asked with the type the key names and the OpenSSH form of
    // the key the server sent
    expect(seen).toEqual([{ type: "ssh-ed25519", fingerprint }]);
    expect(conn.hostKey).toEqual({ type: "ssh-ed25519", fingerprint });
  });

  it("hands over the key the server switched to, with its type", async () => {
    // A server holds a key of each type and which one the handshake settles on
    // moves on its own: the server gains a key, or the ssh library reorders the
    // types it prefers. Told apart from a substitution only by the type coming
    // along — with the fingerprint alone the two look the same
    const { __hostKeys, __presentHostKey } = await ssh2Mock();
    __presentHostKey(__hostKeys.rsa);
    const seen: HostKey[] = [];

    const conn = await SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: (key) => {
        seen.push(key);
        return true;
      },
    });

    const rsaKey: HostKey = { type: "ssh-rsa", fingerprint: fingerprintOf(__hostKeys.rsa) };
    expect(seen).toEqual([rsaKey]);
    expect(conn.hostKey).toEqual(rsaKey);
  });

  it("fails with its own error when the key of a known type is another one", async () => {
    const fingerprint = await hostFingerprint();
    const pending = SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: (key) => key.fingerprint === "SHA256:the-key-this-server-used-to-have",
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
    // The key travels with the error: what is offered for confirmation later
    // has to carry its type, and the refused handshake is where it is seen
    expect(rejection.hostKey).toEqual({ type: "ssh-ed25519", fingerprint });
    // Not folded into the generic "could not connect" wrapper
    expect(rejection.message).not.toContain("Host denied");
  });

  it("asks for the algorithms of a known key type first", async () => {
    // What keeps the negotiated type from drifting: a server that has since
    // gained a key of another type, and an ssh library that reorders the types
    // it prefers, both still settle on the type that is already known
    const { __clients } = await ssh2Mock();

    await SshConnection.connect({
      host: "h.example",
      username: "deploy",
      password: "p",
      verifyHostKey: () => true,
      knownHostKeyTypes: ["ssh-rsa"],
    });

    // An RSA key is presented under all three of these and names itself
    // "ssh-rsa" in each case, so one known type moves the three. The rest stay
    // on the list: a server that no longer has an RSA key still connects, and
    // the verifier is what decides whether the key it does present is accepted
    expect(__clients.at(-1)?.config?.algorithms?.serverHostKey).toEqual([
      "rsa-sha2-512",
      "rsa-sha2-256",
      "ssh-rsa",
      "ssh-ed25519",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
    ]);
  });

  it("leaves the algorithms to ssh2 when no known type moves them", async () => {
    // A server with nothing on record, and a type with no algorithm to ask for:
    // naming one ssh2 does not implement makes it refuse the connection
    // outright, which would lock the user out instead of reporting a key
    const { __clients } = await ssh2Mock();

    for (const knownHostKeyTypes of [undefined, [], ["ssh-not-an-algorithm"]]) {
      await SshConnection.connect({
        host: "h.example",
        username: "deploy",
        password: "p",
        verifyHostKey: () => true,
        knownHostKeyTypes,
      });

      expect(__clients.at(-1)?.config?.algorithms?.serverHostKey).toBeUndefined();
    }
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
