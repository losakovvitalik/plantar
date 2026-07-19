import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

/**
 * Убирает из authorized_keys ключи с этим комментарием — перед установкой нового
 * ключа взамен старого. Комментарий приходит из имени проекта (только [a-z0-9-]),
 * поэтому в шаблон grep он попадает без спецсимволов; `$` привязывает к концу
 * строки, чтобы «plantar-ci-app» не задел «plantar-ci-app2».
 */
export async function removeKeysWithComment(
  conn: SshConnection,
  comment: string,
): Promise<void> {
  const pattern = shellQuote(` ${comment}$`);
  const keys = "~/.ssh/authorized_keys";
  const result = await conn.exec(
    `if [ -f ${keys} ]; then { grep -v ${pattern} ${keys} || true; } > ${keys}.plantar-tmp && mv ${keys}.plantar-tmp ${keys} && chmod 600 ${keys}; fi`,
  );
  if (result.code !== 0) {
    throw new Error(t("removeKeyFailed", { stderr: result.stderr }));
  }
}

/** Похоже ли содержимое файла на приватный SSH-ключ (OpenSSH или PEM) */
export function looksLikePrivateKey(content: string): boolean {
  return content.startsWith("-----BEGIN") && content.includes("PRIVATE KEY");
}

export interface DetectedSshKey {
  path: string;
  /** Имя файла — для показа в списке выбора */
  label: string;
}

/**
 * Ищет приватные ключи в ~/.ssh — для сценария «ключ уже настроен через
 * панель хостинга». Нечитаемые и посторонние файлы (конфиги, .pub) пропускаются.
 */
export function detectUserSshKeys(): DetectedSshKey[] {
  const dir = path.join(homedir(), ".ssh");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const found: DetectedSshKey[] = [];
  for (const name of entries) {
    if (name.endsWith(".pub")) continue;
    const full = path.join(dir, name);
    try {
      if (!statSync(full).isFile()) continue;
      if (looksLikePrivateKey(readFileSync(full, "utf8"))) {
        found.push({ path: full, label: name });
      }
    } catch {
      // нет прав на чтение — просто не показываем этот файл
    }
  }
  return found;
}

/** Запись из ~/.ssh/config, пригодная для предзаполнения формы добавления сервера */
export interface SshConfigHost {
  /** Алиас из строки Host — идёт в название сервера */
  name: string;
  host: string;
  port?: number;
  user?: string;
  /** Путь к ключу (IdentityFile), если файл существует */
  identityFile?: string;
}

// Git-хостинги в ~/.ssh/config — не серверы для деплоя, их не предлагаем
const GIT_HOSTS = new Set(["github.com", "ssh.github.com", "gitlab.com", "bitbucket.org"]);

/**
 * Разбирает простые Host-блоки из ~/.ssh/config для подсказок в форме
 * добавления сервера. Сложные случаи (шаблоны с * и ?, Match, Include,
 * подстановки %) пропускаются — лучше не предложить, чем предложить неверное.
 */
export function detectSshConfigHosts(): SshConfigHost[] {
  let content: string;
  try {
    content = readFileSync(path.join(homedir(), ".ssh", "config"), "utf8");
  } catch {
    return [];
  }

  // Первое значение директивы; значение в кавычках может содержать пробелы
  const firstToken = (v: string) =>
    v.startsWith('"') ? v.slice(1, v.indexOf('"', 1)) : v.split(/\s+/)[0];
  const hosts: SshConfigHost[] = [];
  let current: { alias: string; props: Map<string, string> } | null = null;

  const flush = () => {
    if (!current) return;
    const { alias, props } = current;
    current = null;
    const host = props.get("hostname") ?? alias;
    if (host.includes("%") || GIT_HOSTS.has(host.toLowerCase())) return;

    let identityFile = props.get("identityfile");
    if (identityFile) {
      identityFile = identityFile.replace(/^~(?=\/|$)/, homedir());
      try {
        if (!looksLikePrivateKey(readFileSync(identityFile, "utf8"))) identityFile = undefined;
      } catch {
        identityFile = undefined;
      }
    }

    hosts.push({
      name: alias,
      host,
      port: Number(props.get("port")) || undefined,
      user: props.get("user"),
      identityFile,
    });
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // Синтаксис директивы: «Ключ значение», допускается «Ключ=значение»
    const match = line.match(/^(\S+?)(?:\s+|\s*=\s*)(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (key === "match") {
      // Условный блок — прекращаем и его, и текущий Host-блок
      flush();
      continue;
    }
    if (key === "host") {
      flush();
      if (!/[*?!]/.test(value)) current = { alias: firstToken(value), props: new Map() };
      continue;
    }
    if (current && !current.props.has(key)) {
      current.props.set(key, firstToken(value));
    }
  }
  flush();
  return hosts;
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
