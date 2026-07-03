import { execFile } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { SshConnection } from "@plantar/ssh";
import { keysDir } from "@plantar/storage";

const execFileAsync = promisify(execFile);

/** Создаёт пару ключей ed25519 в хранилище Plantar, возвращает путь к приватному */
export async function generateKeyPair(serverId: string, comment: string): Promise<string> {
  const keyPath = path.join(keysDir(), serverId);
  // ssh-keygen интерактивно спрашивает про перезапись — убираем остатки неудачных попыток
  rmSync(keyPath, { force: true });
  rmSync(`${keyPath}.pub`, { force: true });
  await execFileAsync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", comment]);
  return keyPath;
}

/** Добавляет публичный ключ в authorized_keys на сервере (идемпотентно) */
export async function installPublicKey(conn: SshConnection, keyPath: string): Promise<void> {
  const pub = readFileSync(`${keyPath}.pub`, "utf8").trim();
  const result = await conn.exec(
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && { grep -qxF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys; }`,
  );
  if (result.code !== 0) {
    throw new Error(`Не удалось установить ключ на сервер:\n${result.stderr}`);
  }
}
