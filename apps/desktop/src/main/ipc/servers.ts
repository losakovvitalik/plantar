import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app, dialog } from "electron";
import { discoverApps, getServerInfo } from "@plantar/core";
import { SshConnection } from "@plantar/ssh";
import {
  type ServerRecord,
  readAppStatusCache,
  readProjects,
  readServers,
  writeAppStatusCache,
  writeProjects,
  writeServers,
} from "@plantar/storage";
import type { AddServerInput } from "../../shared/ipc";
import { forgetServer } from "../app-monitor";
import { collectServerAppStatuses } from "../app-statuses";
import { connectWithPassword, withServer } from "../connections";
import { t } from "../i18n";
import { getServer, projectConfig } from "../records";
import { dropConnection, isConnected } from "../ssh-pool";
import {
  detectSshConfigHosts,
  detectUserSshKeys,
  generateKeyPair,
  installPublicKey,
  looksLikePrivateKey,
  storePrivateKey,
} from "../ssh-setup";
import { activeWindow } from "../window";
import { handle, toResult } from "./util";

/** Переводит технические ошибки ssh2 при входе по готовому ключу на язык пользователя */
function friendlyKeyError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/passphrase/i.test(message)) return new Error(t("keyPassphraseUnsupported"));
  if (/authentication/i.test(message)) return new Error(t("keyAuthFailed"));
  return err instanceof Error ? err : new Error(message);
}

async function addServer(input: AddServerInput): Promise<ServerRecord> {
  const id = randomUUID();
  const base = {
    id,
    name: input.name || input.host,
    host: input.host,
    port: input.port,
    user: input.user,
  };

  let record: ServerRecord;
  if (input.auth === "key") {
    const { privateKeyPem, publicKey } = await generateKeyPair(id, `plantar-${base.name}`);
    const conn = await connectWithPassword(base, input.password);
    try {
      await installPublicKey(conn, publicKey);
    } finally {
      conn.close();
    }
    // Проверяем, что ключ действительно работает, прежде чем сохранить сервер
    const test = await SshConnection.connect({
      host: base.host,
      port: base.port,
      username: base.user,
      privateKey: privateKeyPem,
    });
    test.close();
    const keyPath = storePrivateKey(id, privateKeyPem);
    record = { ...base, auth: "key", keyPath };
  } else if (input.auth === "existing-key") {
    // Ключ уже добавлен на сервер (например, через панель хостинга) — пароля нет,
    // просто проверяем, что подключение этим ключом проходит, и запоминаем путь
    if (!input.keyPath) throw new Error(t("keyFileMissing"));
    let pem: string;
    try {
      pem = readFileSync(input.keyPath, "utf8");
    } catch {
      throw new Error(t("keyFileInvalid"));
    }
    if (!looksLikePrivateKey(pem)) throw new Error(t("keyFileInvalid"));
    try {
      const test = await SshConnection.connect({
        host: base.host,
        port: base.port,
        username: base.user,
        privateKey: pem,
      });
      test.close();
    } catch (err) {
      throw friendlyKeyError(err);
    }
    record = { ...base, auth: "key", keyPath: input.keyPath };
  } else {
    const conn = await connectWithPassword(base, input.password);
    conn.close();
    record = { ...base, auth: "password" };
  }

  writeServers([...readServers(), record]);
  return record;
}

export function registerServersIpc(): void {
  handle("servers:list", () => toResult(async () => readServers()));
  handle("servers:add", (_e, input) => toResult(() => addServer(input)));
  // Готовые ключи пользователя из ~/.ssh — для способа входа «ключ уже настроен»
  handle("ssh:detectKeys", () => toResult(async () => detectUserSshKeys()));
  // Серверы из ~/.ssh/config — подсказки для предзаполнения формы
  handle("ssh:configHosts", () => toResult(async () => detectSshConfigHosts()));
  handle("ssh:pickKey", () =>
    toResult(async () => {
      const win = activeWindow();
      if (!win) return null;
      const picked = await dialog.showOpenDialog(win, {
        title: t("pickKeyFileTitle"),
        defaultPath: path.join(app.getPath("home"), ".ssh"),
        properties: ["openFile", "showHiddenFiles"],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const keyPath = picked.filePaths[0];
      let content: string;
      try {
        content = readFileSync(keyPath, "utf8");
      } catch {
        throw new Error(t("keyFileInvalid"));
      }
      if (!looksLikePrivateKey(content)) throw new Error(t("keyFileInvalid"));
      return keyPath;
    }),
  );
  handle("servers:remove", (_e, id) =>
    toResult(async () => {
      dropConnection(id);
      forgetServer(id);
      writeServers(readServers().filter((s) => s.id !== id));
      writeProjects(readProjects().filter((p) => p.serverId !== id));
      // Убираем осиротевший снимок статусов приложений
      const statusCache = readAppStatusCache();
      if (id in statusCache) {
        delete statusCache[id];
        writeAppStatusCache(statusCache);
      }
    }),
  );

  // Порядок серверов в сайдбаре, заданный перетаскиванием; неизвестные
  // ids игнорируются, недостающие серверы остаются в конце в прежнем порядке
  handle("servers:reorder", (_e, ids) =>
    toResult(async () => {
      const servers = readServers();
      const byId = new Map(servers.map((s) => [s.id, s]));
      const ordered = ids.flatMap((id) => byId.get(id) ?? []);
      const rest = servers.filter((s) => !ids.includes(s.id));
      writeServers([...ordered, ...rest]);
    }),
  );

  // Обнаружение приложений, запущенных на сервере до подключения Plantar
  handle("server:discover", (_e, args) =>
    toResult(async () => {
      const server = getServer(args.serverId);
      const apps = await withServer(server, args.password, (conn) => discoverApps(conn));
      // Приложения, уже добавленные в Plantar, повторно не предлагаем
      const taken = new Set<string>();
      for (const p of readProjects().filter((p) => p.serverId === args.serverId)) {
        taken.add(p.name);
        if (p.external) taken.add(p.external.pm2Name);
        try {
          taken.add(projectConfig(p).name);
        } catch {
          /* plantar.json недоступен — имя записи уже учтено */
        }
      }
      return apps.filter((a) => !taken.has(a.pm2Name) && !taken.has(a.suggestedName));
    }),
  );

  handle("server:info", (_e, args) =>
    toResult(async () =>
      withServer(getServer(args.serverId), args.password, (conn) => getServerInfo(conn)),
    ),
  );
  handle("server:isConnected", (_e, serverId) =>
    toResult(async () => isConnected(serverId)),
  );
  // Статусы приложений сервера: pm2-процессы одним запросом плюс живая
  // HTTP-проверка сайтов с самого сервера; снимок кэшируется
  // для мгновенного показа при следующем открытии приложения
  handle("server:appStatuses", (_e, args) =>
    toResult(() => collectServerAppStatuses(getServer(args.serverId))),
  );
  // Кэш статусов прошлой проверки — показывается сразу, пока идёт живая
  handle("server:appStatusesCache", () =>
    toResult(async () => readAppStatusCache()),
  );
}
