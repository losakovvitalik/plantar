import { readServers, writeServers } from "@plantar/storage";

/**
 * Which host key a server is allowed to identify itself with — the policy the
 * SSH layer only asks about, and the one place that answers it.
 *
 * Trust on first use: the first connection records the key the server presented
 * and every later connection has to present the same one. A server added before
 * host keys were checked has none stored — it records its key on the next
 * connection instead of forcing the user to add the server again.
 */
export function hostKeyVerifier(expected: string | undefined) {
  return (fingerprint: string): boolean => expected === undefined || expected === fingerprint;
}

/**
 * Records the host key of a server that had none. Called after the connection
 * succeeded, so only a key that actually carried a session gets stored. A
 * server that already has one is left alone: overwriting it here would undo
 * the check the record exists for.
 */
export function rememberHostKey(serverId: string, fingerprint: string): void {
  const servers = readServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server || server.hostKeyFingerprint) return;
  server.hostKeyFingerprint = fingerprint;
  writeServers(servers);
}

/**
 * Host key policy while a server is being added: there is no record yet, so the
 * first of the connections that adding makes settles which key this server has,
 * and the rest of the setup must see that same key. Without the pinning, a
 * server swapped between installing the key and testing it would end up saved
 * under the impostor's key.
 */
export function pinFirstHostKey() {
  let pinned: string | undefined;
  return {
    verify: (fingerprint: string): boolean => {
      pinned ??= fingerprint;
      return pinned === fingerprint;
    },
    /** The key that was settled on; undefined until the first connection */
    get fingerprint(): string | undefined {
      return pinned;
    },
  };
}
