import type { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SshConnection } from "./index";

interface FakeChannel extends EventEmitter {
  stderr: EventEmitter;
  end: () => void;
  close: () => void;
}

interface FakeClient extends EventEmitter {
  execCalls: Array<{ command: string; channel: FakeChannel }>;
}

// Replaces ssh2 with a fake whose exec() hands out inert channels the tests
// drive by emitting events. __clients exposes created clients to the tests.
vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");

  class Channel extends EventEmitter {
    stderr = new EventEmitter();
    end(): void {}
    close(): void {}
  }

  const clients: Client[] = [];

  class Client extends EventEmitter {
    execCalls: Array<{ command: string; channel: Channel }> = [];

    connect(): this {
      clients.push(this);
      queueMicrotask(() => this.emit("ready"));
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

  return { Client, __clients: clients };
});

async function connect(): Promise<{ conn: SshConnection; client: FakeClient }> {
  const { __clients } = (await import("ssh2")) as unknown as { __clients: FakeClient[] };
  const conn = await SshConnection.connect({ host: "test", username: "u", password: "p" });
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
