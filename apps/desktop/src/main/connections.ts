import { SshConnection } from "@plantar/ssh";
import type { ServerRecord } from "@plantar/storage";
import { hostKeyVerifier, rememberHostKey } from "./host-keys";
import { t } from "./i18n";
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
  });
  // Only a server without a recorded key has anything to record — skip the
  // read of the store on every later connection
  if (!server.hostKeyFingerprint) rememberHostKey(server.id, conn.hostKeyFingerprint);
  return conn;
}

/** Операция на соединении из пула: живое переиспользуется, пароль нужен только для нового */
export const withServer = <T>(
  server: ServerRecord,
  password: string | undefined,
  fn: (conn: SshConnection) => Promise<T>,
): Promise<T> => withPooledConnection(server.id, () => connect(server, password), fn);

/** Подключение к серверу, которого ещё нет в записях: политику проверки
 *  ключа сервера задаёт вызывающий — записи с сохранённым ключом пока нет */
export function connectWithPassword(
  base: { host: string; port: number; user: string },
  password: string,
  verifyHostKey: (fingerprint: string) => boolean,
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
