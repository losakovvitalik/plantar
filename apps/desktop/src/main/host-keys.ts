import type { HostKey, HostKeyVerifier } from "@plantar/ssh";
import { type ServerRecord, readServers, writeServers } from "@plantar/storage";

/** The part of a server record the host key policy reads */
type WithHostKeys = Pick<ServerRecord, "hostKeyFingerprint" | "hostKeys">;

/**
 * Which host key a server is allowed to identify itself with — the policy the
 * SSH layer only asks about, and the one place that answers it.
 *
 * Trust on first use, per key type, the way `known_hosts` keeps host keys: the
 * first connection records the key the server presented, and every later
 * connection has to present the same key of that type. Nothing else passes —
 * a key of a type not on record has nothing to be compared against, and
 * accepting it would let anything answering at that address be taken for the
 * server just by offering a type the record has never seen.
 *
 * The other half of the rule is at the connect site (connections.ts): the types
 * on record are asked for first, so a server that has since gained a key of
 * another type, or an ssh library that reorders the types it prefers, still
 * answers with the recorded key. What is left for this to turn down is a server
 * that no longer has the recorded key at all — which is what the "answers
 * differently than before" alarm is for.
 *
 * A server added before host keys were checked has nothing on record — it
 * records its key on the next connection instead of forcing the user to add the
 * server again.
 */
export function hostKeyVerifier(server: WithHostKeys): HostKeyVerifier {
  return (key: HostKey): boolean => {
    const recorded = server.hostKeys;
    if (recorded?.length) {
      return recorded.some((k) => k.type === key.type && k.fingerprint === key.fingerprint);
    }
    // A record from before types were kept: which type its fingerprint belongs
    // to is unknown, so nothing else can be told apart from a substitution next
    // to it — only that fingerprint itself passes, and matching it is what
    // turns the record into a typed one (rememberHostKey)
    if (server.hostKeyFingerprint) return server.hostKeyFingerprint === key.fingerprint;
    return true;
  };
}

/** Whether the record already holds this exact key — the case on every
 *  connection after the first once the record is typed, and only then does it
 *  spare a read of the store. A record written by #135 (a bare fingerprint, no
 *  type) answers no whatever the store holds, so such a server keeps going
 *  through rememberHostKey until the first match upgrades it to a typed one. */
export function hostKeyRecorded(server: WithHostKeys, key: HostKey): boolean {
  if (server.hostKeyFingerprint) return false;
  return (
    server.hostKeys?.some((k) => k.type === key.type && k.fingerprint === key.fingerprint) ??
    false
  );
}

/**
 * Records the key a connection was established with, when the record has
 * nothing for its type yet. Called after the connection succeeded, so only a
 * key that actually carried a session gets stored. In practice that is the
 * server's first connection: a key of a type not on record does not get past
 * the verifier, so a record that holds a typed key already keeps just that one.
 * A type already on record is left alone in any case — overwriting it here
 * would undo the check the record exists for.
 */
export function rememberHostKey(serverId: string, key: HostKey): void {
  const servers = readServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) return;
  const keys = server.hostKeys ?? [];
  if (keys.some((k) => k.type === key.type)) return;
  if (server.hostKeyFingerprint) {
    // The typeless record is what let this connection through, so this is the
    // same key, now with its type known. A key that does not match it is not
    // recorded next to it: that record cannot say which type it covers
    if (server.hostKeyFingerprint !== key.fingerprint) return;
    delete server.hostKeyFingerprint;
  }
  server.hostKeys = [...keys, key];
  writeServers(servers);
}

/**
 * Records the key the server presents now in place of the ones on record — the
 * user confirmed the change is expected, the machine having been reinstalled.
 * A reinstall leaves none of the earlier keys behind, so the confirmed key
 * replaces the whole set instead of joining it. Deliberately not a relaxation
 * of rememberHostKey: never overwriting is what makes the stored keys worth
 * checking against, and only an explicit, confirmed request reaches this one. A
 * server no longer in the records has nothing to record — it was removed while
 * the confirmation was on screen.
 */
export function trustNewHostKey(serverId: string, key: HostKey): void {
  const servers = readServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) return;
  server.hostKeys = [key];
  delete server.hostKeyFingerprint;
  writeServers(servers);
}

/**
 * Host key policy while a server is being added: there is no record yet, so the
 * first of the connections that adding makes settles which key this server has,
 * and the rest of the setup must see that same key. Without the pinning, a
 * server swapped between installing the key and testing it would end up saved
 * under the impostor's key.
 */
export function pinFirstHostKey(): {
  verify: HostKeyVerifier;
  readonly key: HostKey | undefined;
} {
  let pinned: HostKey | undefined;
  return {
    verify: (key: HostKey): boolean => {
      pinned ??= key;
      return pinned.type === key.type && pinned.fingerprint === key.fingerprint;
    },
    /** The key that was settled on; undefined until the first connection */
    get key(): HostKey | undefined {
      return pinned;
    },
  };
}
