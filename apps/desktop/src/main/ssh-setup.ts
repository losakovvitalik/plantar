import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { safeStorage } from "electron";
import { SshConnection, shellQuote } from "@plantar/ssh";
import { keysDir, readServers, writeServers } from "@plantar/storage";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);

export interface GeneratedKeyPair {
  privateKeyPem: string;
  publicKey: string;
}

/**
 * Создаёт пару ключей ed25519. Приватный ключ возвращается в память,
 * файл с диска сразу удаляется — сохранение только через storePrivateKey().
 */
export async function generateKeyPair(
  serverId: string,
  comment: string,
): Promise<GeneratedKeyPair> {
  const keyPath = path.join(keysDir(), serverId);
  // ssh-keygen интерактивно спрашивает про перезапись — убираем остатки неудачных попыток
  rmSync(keyPath, { force: true });
  rmSync(`${keyPath}.pub`, { force: true });
  await execFileAsync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", comment]);

  const privateKeyPem = readFileSync(keyPath, "utf8");
  const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
  rmSync(keyPath);
  return { privateKeyPem, publicKey };
}

/**
 * Сохраняет приватный ключ зашифрованным через системный keychain (safeStorage).
 * Возвращает путь к файлу для ServerRecord.keyPath. Если шифрование недоступно
 * (Linux без libsecret) — падаем обратно на файл с правами 0600.
 */
export function storePrivateKey(serverId: string, privateKeyPem: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encPath = path.join(keysDir(), `${serverId}.enc`);
    writeFileSync(encPath, safeStorage.encryptString(privateKeyPem), { mode: 0o600 });
    return encPath;
  }
  const plainPath = path.join(keysDir(), serverId);
  writeFileSync(plainPath, privateKeyPem, { mode: 0o600 });
  return plainPath;
}

/** Читает приватный ключ: .enc — расшифровывает, иначе обычный файл (в т.ч. ~/.ssh) */
export function loadPrivateKey(keyPath: string): string {
  if (keyPath.endsWith(".enc")) {
    return safeStorage.decryptString(readFileSync(keyPath));
  }
  return readFileSync(keyPath, "utf8");
}

/**
 * Разовая миграция: шифрует сгенерированные ранее ключи, лежавшие открытым текстом.
 * Трогает только файлы внутри хранилища Plantar — пользовательские ~/.ssh не наши.
 */
export function migratePlainKeys(): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const dir = keysDir();
  const servers = readServers();
  let changed = false;

  for (const server of servers) {
    const plain =
      server.auth === "key" &&
      server.keyPath &&
      !server.keyPath.endsWith(".enc") &&
      path.dirname(server.keyPath) === dir &&
      existsSync(server.keyPath);
    if (!plain) continue;

    const pem = readFileSync(server.keyPath!, "utf8");
    const encPath = storePrivateKey(server.id, pem);
    // Прежде чем удалять исходник — убеждаемся, что расшифровка возвращает то же самое
    if (loadPrivateKey(encPath) !== pem) {
      rmSync(encPath, { force: true });
      continue;
    }
    rmSync(server.keyPath!);
    server.keyPath = encPath;
    changed = true;
  }

  if (changed) writeServers(servers);
}

/** Добавляет публичный ключ в authorized_keys на сервере (идемпотентно) */
export async function installPublicKey(conn: SshConnection, publicKey: string): Promise<void> {
  // Ключ содержит комментарий с именем сервера — экранируем, имя ничем не ограничено
  const quotedKey = shellQuote(publicKey);
  const result = await conn.exec(
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && { grep -qxF ${quotedKey} ~/.ssh/authorized_keys || echo ${quotedKey} >> ~/.ssh/authorized_keys; }`,
  );
  if (result.code !== 0) {
    throw new Error(t("installKeyFailed", { stderr: result.stderr }));
  }
}
