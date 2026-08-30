import { type HostKeyVerifier, HostKeyRejectedError, SshConnection } from "@plantar/ssh";
import type { ServerRecord } from "@plantar/storage";
import { hostKeyVerifier, rememberHostKey } from "./host-keys";
import { t } from "./i18n";
import { clearIdentityChanged, reportIdentityChanged } from "./server-identity";
import { loadPrivateKey } from "./ssh-setup";
import { withPooledConnection } from "./ssh-pool";

export async function connect(
  server: ServerRecord,
  password?: string,
): Promise<SshConnection> {
  if (server.auth === "password" && !password) {
    throw new Error(t("passwordRequired"));
  }
  const conn = await SshConnection.connect({
    host: server.host,
    port: server.port,
    username: server.user,
    password: server.auth === "password" ? password : undefined,
    privateKey: server.auth === "key" ? loadPrivateKey(server.keyPath!) : undefined,
    verifyHostKey: hostKeyVerifier(server.hostKeyFingerprint),
  }).catch((err: unknown) => {
    // The silent status sweep cannot find a changed key on a password server —
    // it never connects to one without a password — so the operation that ran
    // into the mismatch is what has to report it
    if (err instanceof HostKeyRejectedError) {
      reportIdentityChanged(server.id, err.fingerprint);
    }
    throw err;
  });
  // The server presented the recorded key: whatever put its identity in
  // question is over, and neither the window nor the monitor should keep
  // warning about it
  clearIdentityChanged(server.id);
  // Only a server without a recorded key has anything to record — skip the
  // read of the store on every later connection
  if (!server.hostKeyFingerprint) {
    try {
      rememberHostKey(server.id, conn.hostKeyFingerprint);
    } catch (err) {
      // Writes throw by the storage package's convention, and this one runs on
      // a connection that is already open: letting it out would lose the only
      // reference to that connection, leaving it open until the process exits.
      // An unrecorded key just means the next connection trusts on first use
      // again — the state this server was already in.
      console.error("plantar: failed to record the server host key", err);
    }
  }
  return conn;
}

/** Операция на соединении из пула: живое переиспользуется, пароль нужен только для нового */
export const withServer = <T>(
  server: ServerRecord,
  password: string | undefined,
  fn: (conn: SshConnection) => Promise<T>,
): Promise<T> => withPooledConnection(server.id, () => connect(server, password), fn);

/** Connects to a server that has no record yet: the caller owns the host key
 *  policy — there is no stored key to check against at this point */
export function connectWithPassword(
  base: { host: string; port: number; user: string },
  password: string,
  verifyHostKey: HostKeyVerifier,
): Promise<SshConnection> {
  if (!password) throw new Error(t("enterPassword"));
  return SshConnection.connect({
    host: base.host,
    port: base.port,
    username: base.user,
    password,
    verifyHostKey,
  });
}
