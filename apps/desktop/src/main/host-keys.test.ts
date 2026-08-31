import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HostKey } from "@plantar/ssh";
import { type ServerRecord, readServers, writeServers } from "@plantar/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hostKeyRecorded,
  hostKeyVerifier,
  pinFirstHostKey,
  rememberHostKey,
  trustNewHostKey,
} from "./host-keys";

const KEY: HostKey = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
/** Another key of the same type — a server actually being answered for by
 *  something else, the case the record exists to catch */
const OTHER_KEY: HostKey = {
  type: "ssh-ed25519",
  fingerprint: "SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};
/** The same server answering with a key of a type it also holds */
const RSA_KEY: HostKey = {
  type: "ssh-rsa",
  fingerprint: "SHA256:ccccccccccccccccccccccccccccccccccccccccccc",
};

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
    expect(hostKeyVerifier(server)(KEY)).toBe(true);
  });

  it("accepts the recorded key and turns down another key of that type", () => {
    const verify = hostKeyVerifier({ hostKeys: [KEY] });
    expect(verify(KEY)).toBe(true);
    expect(verify(OTHER_KEY)).toBe(false);
  });

  it("turns down a key of a type that is not on record", () => {
    // Nothing on record can vouch for it, so accepting it would let anything
    // answering at that address pass just by offering an unseen type. A server
    // that gained a key never gets this far: the recorded types are asked for
    // first, so the handshake still settles on the key that is on record
    expect(hostKeyVerifier({ hostKeys: [KEY] })(RSA_KEY)).toBe(false);
  });

  it("keeps checking the types it does know", () => {
    // A server with two keys on record answers with either of them and with
    // nothing else
    const verify = hostKeyVerifier({ hostKeys: [KEY, RSA_KEY] });
    expect(verify(KEY)).toBe(true);
    expect(verify(RSA_KEY)).toBe(true);
    expect(verify(OTHER_KEY)).toBe(false);
  });

  it("accepts the key a typeless record was written for", () => {
    // Written before types were kept with fingerprints; it must keep working
    expect(hostKeyVerifier({ hostKeyFingerprint: KEY.fingerprint })(KEY)).toBe(true);
  });

  it("turns down every other key while the record is typeless", () => {
    // Which type that fingerprint belongs to is unknown, so a key of any other
    // type could be the substitution the record exists to catch
    const verify = hostKeyVerifier({ hostKeyFingerprint: KEY.fingerprint });
    expect(verify(OTHER_KEY)).toBe(false);
    expect(verify(RSA_KEY)).toBe(false);
  });
});

describe("hostKeyRecorded", () => {
  it("knows the key that is already on record", () => {
    expect(hostKeyRecorded({ hostKeys: [KEY] }, KEY)).toBe(true);
    expect(hostKeyRecorded({ hostKeys: [KEY] }, RSA_KEY)).toBe(false);
    expect(hostKeyRecorded({ hostKeys: [KEY] }, OTHER_KEY)).toBe(false);
  });

  it("counts a typeless record as not holding the key", () => {
    // It holds the fingerprint but not the type — the connection that matches
    // it has that to add
    expect(hostKeyRecorded({ hostKeyFingerprint: KEY.fingerprint }, KEY)).toBe(false);
  });
});

describe("rememberHostKey", () => {
  it("records the key of a server that had none", () => {
    writeServers([server]);

    rememberHostKey(server.id, KEY);

    expect(readServers()[0].hostKeys).toEqual([KEY]);
  });

  it("records a key of a type the server had none of", () => {
    // The other branch of the guard below. No connection brings such a key here
    // — the verifier turns it down first — so this pins what the record would
    // do if that policy were relaxed: keep what it holds and add to it
    writeServers([{ ...server, hostKeys: [KEY] }]);

    rememberHostKey(server.id, RSA_KEY);

    expect(readServers()[0].hostKeys).toEqual([KEY, RSA_KEY]);
  });

  it("leaves a recorded type alone", () => {
    // Overwriting here would silently accept the substitution the stored
    // fingerprint exists to catch
    writeServers([{ ...server, hostKeys: [KEY] }]);

    rememberHostKey(server.id, OTHER_KEY);

    expect(readServers()[0].hostKeys).toEqual([KEY]);
  });

  it("gives a typeless record the type of the key that matched it", () => {
    // The upgrade path for records written before types were kept: from here on
    // the server may also answer with a key of another type
    writeServers([{ ...server, hostKeyFingerprint: KEY.fingerprint }]);

    rememberHostKey(server.id, KEY);

    expect(readServers()[0]).toEqual({ ...server, hostKeys: [KEY] });
  });

  it("does not put a key of another type next to a typeless record", () => {
    // Such a key never gets past the verifier; recording it would pin a key the
    // record cannot vouch for
    writeServers([{ ...server, hostKeyFingerprint: KEY.fingerprint }]);

    rememberHostKey(server.id, RSA_KEY);

    expect(readServers()[0]).toEqual({ ...server, hostKeyFingerprint: KEY.fingerprint });
  });

  it("ignores a server that is not in the records", () => {
    writeServers([server]);

    rememberHostKey("gone", KEY);

    expect(readServers()).toEqual([server]);
  });
});

describe("trustNewHostKey", () => {
  it("replaces every recorded key and leaves the rest of the record alone", () => {
    // The remedy for a server the hosting provider reinstalled. Removing it
    // was the only way out before, and that took its projects with it. A
    // reinstall leaves none of the earlier keys behind, whatever their type
    const record: ServerRecord = { ...server, hostKeys: [KEY, RSA_KEY] };
    writeServers([record]);

    trustNewHostKey(server.id, OTHER_KEY);

    expect(readServers()).toEqual([{ ...record, hostKeys: [OTHER_KEY] }]);
  });

  it("replaces a typeless record too", () => {
    writeServers([{ ...server, hostKeyFingerprint: KEY.fingerprint }]);

    trustNewHostKey(server.id, OTHER_KEY);

    expect(readServers()).toEqual([{ ...server, hostKeys: [OTHER_KEY] }]);
  });

  it("touches only the server it was asked about", () => {
    const other: ServerRecord = { ...server, id: "s2", hostKeys: [KEY] };
    writeServers([{ ...server, hostKeys: [KEY] }, other]);

    trustNewHostKey(server.id, OTHER_KEY);

    expect(readServers()[1]).toEqual(other);
  });

  it("ignores a server that is not in the records", () => {
    // Removed while the confirmation was on screen — there is nothing to record
    writeServers([server]);

    trustNewHostKey("gone", KEY);

    expect(readServers()).toEqual([server]);
  });
});

describe("pinFirstHostKey", () => {
  it("settles on the first key and turns down a different one", () => {
    const pin = pinFirstHostKey();
    expect(pin.key).toBeUndefined();

    // The connection that adds the server settles the key; the ones that
    // install and test the key have to land on the same machine
    expect(pin.verify(KEY)).toBe(true);
    expect(pin.verify(KEY)).toBe(true);
    expect(pin.verify(OTHER_KEY)).toBe(false);
    // Adding a server takes seconds: nothing about it can change the type the
    // handshake settles on, so a key of another type is as unexpected here
    expect(pin.verify(RSA_KEY)).toBe(false);

    expect(pin.key).toEqual(KEY);
  });
});
