import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ServerRecord, readServers, writeServers } from "@plantar/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostKeyVerifier, pinFirstHostKey, rememberHostKey } from "./host-keys";

const KEY = "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_KEY = "SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "key",
};

let tmpHome: string;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-host-keys-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("hostKeyVerifier", () => {
  it("accepts any key when the server has none recorded", () => {
    // Servers added before host keys were checked: they must keep working
    // instead of being forced through a re-add
    expect(hostKeyVerifier(undefined)(KEY)).toBe(true);
  });

  it("accepts the recorded key and turns down every other", () => {
    const verify = hostKeyVerifier(KEY);
    expect(verify(KEY)).toBe(true);
    expect(verify(OTHER_KEY)).toBe(false);
  });
});

describe("rememberHostKey", () => {
  it("records the key of a server that had none", () => {
    writeServers([server]);

    rememberHostKey(server.id, KEY);

    expect(readServers()[0].hostKeyFingerprint).toBe(KEY);
  });

  it("leaves a recorded key alone", () => {
    // Overwriting here would silently accept the substitution the stored
    // fingerprint exists to catch
    writeServers([{ ...server, hostKeyFingerprint: KEY }]);

    rememberHostKey(server.id, OTHER_KEY);

    expect(readServers()[0].hostKeyFingerprint).toBe(KEY);
  });

  it("ignores a server that is not in the records", () => {
    writeServers([server]);

    rememberHostKey("gone", KEY);

    expect(readServers()).toEqual([server]);
  });
});

describe("pinFirstHostKey", () => {
  it("settles on the first key and turns down a different one", () => {
    const pin = pinFirstHostKey();
    expect(pin.fingerprint).toBeUndefined();

    // The connection that adds the server settles the key; the ones that
    // install and test the key have to land on the same machine
    expect(pin.verify(KEY)).toBe(true);
    expect(pin.verify(KEY)).toBe(true);
    expect(pin.verify(OTHER_KEY)).toBe(false);

    expect(pin.fingerprint).toBe(KEY);
  });
});
