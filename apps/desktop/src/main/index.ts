import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from "electron";
import { SshConnection } from "@plantar/ssh";
import {
  deployProject,
  getServerInfo,
  getSiteLogs,
  readProjectEnv,
  removeDeployedProject,
  writeProjectEnv,
} from "@plantar/core";
import {
  type ProjectConfigInput,
  detectProjectConfig,
  hasProjectConfig,
  loadProjectConfig,
  writeProjectConfig,
} from "@plantar/config";
import {
  DeployLogWriter,
  type ProjectRecord,
  type ServerRecord,
  type AppSettings,
  appendHistory,
  dataDir,
  readHistory,
  readProjects,
  readServers,
  readSettings,
  saveServerLogSnapshot,
  writeProjects,
  writeServers,
  writeSettings,
} from "@plantar/storage";
import {
  generateKeyPair,
  installPublicKey,
  loadPrivateKey,
  migratePlainKeys,
  storePrivateKey,
} from "./ssh-setup";

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function toResult<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function getServer(id: string): ServerRecord {
  const server = readServers().find((s) => s.id === id);
  if (!server) throw new Error("Сервер не найден. Обнови список.");
  return server;
}

function getProject(id: string): ProjectRecord {
  const project = readProjects().find((p) => p.id === id);
  if (!project) throw new Error("Проект не найден. Обнови список.");
  return project;
}

async function connect(server: ServerRecord, password?: string): Promise<SshConnection> {
  if (server.auth === "password" && !password) {
    throw new Error("Для этого сервера нужен пароль.");
  }
  return SshConnection.connect({
    host: server.host,
    port: server.port,
    username: server.user,
    password: server.auth === "password" ? password : undefined,
    privateKey: server.auth === "key" ? loadPrivateKey(server.keyPath!) : undefined,
  });
}

interface AddServerInput {
  name: string;
  host: string;
  port: number;
  user: string;
  auth: "key" | "password";
  /** Для auth=key используется один раз — чтобы установить ключ; не сохраняется */
  password: string;
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
  } else {
    const conn = await connectWithPassword(base, input.password);
    conn.close();
    record = { ...base, auth: "password" };
  }

  writeServers([...readServers(), record]);
  return record;
}

function connectWithPassword(
  base: { host: string; port: number; user: string },
  password: string,
): Promise<SshConnection> {
  if (!password) throw new Error("Введи пароль сервера.");
  return SshConnection.connect({
    host: base.host,
    port: base.port,
    username: base.user,
    password,
  });
}

/** Выбор папки проекта: возвращает путь, конфиг (если plantar.json уже есть) и автоопределённые настройки */
async function pickProjectFolder(win: BrowserWindow) {
  const picked = await dialog.showOpenDialog(win, {
    title: "Выбери папку проекта",
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;

  const projectPath = picked.filePaths[0];
  return {
    path: projectPath,
    config: hasProjectConfig(projectPath) ? loadProjectConfig(projectPath) : null,
    detected: detectProjectConfig(projectPath),
  };
}

interface AddProjectInput {
  serverId: string;
  path: string;
  /** Если передан — GUI создаёт plantar.json в папке проекта */
  config?: ProjectConfigInput;
}

/** Два проекта с одним name на одном сервере деплоились бы в один /var/www/<name> */
function assertNameFreeOnServer(serverId: string, name: string, excludeProjectId?: string): void {
  const clash = readProjects().find((p) => {
    if (p.serverId !== serverId || p.id === excludeProjectId) return false;
    let existingName = p.name;
    try {
      existingName = loadProjectConfig(p.path).name;
    } catch {
      /* plantar.json недоступен — используем имя на момент добавления */
    }
    return existingName === name;
  });
  if (clash) {
    throw new Error(
      `Имя «${name}» уже занято проектом на этом сервере (${clash.path}). ` +
        `Проекты с одинаковым именем деплоятся в одну папку и перетирают друг друга — укажи другое имя.`,
    );
  }
}

function addProject(input: AddProjectInput): ProjectRecord {
  getServer(input.serverId);
  const parsedConfig = input.config ? null : loadProjectConfig(input.path);
  assertNameFreeOnServer(input.serverId, (input.config ?? parsedConfig!).name);
  const config = input.config ? writeProjectConfig(input.path, input.config) : parsedConfig!;
  const record: ProjectRecord = {
    id: randomUUID(),
    serverId: input.serverId,
    name: config.name,
    path: input.path,
  };
  writeProjects([...readProjects(), record]);
  return record;
}

/** Системное уведомление о результате деплоя; клик открывает окно на проекте */
function notifyDeployResult(
  win: BrowserWindow,
  projectId: string,
  projectName: string,
  success: boolean,
): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification(
    success
      ? { title: "Деплой завершён", body: `Проект «${projectName}» опубликован.` }
      : { title: "Деплой не удался", body: `Проект «${projectName}» — произошла ошибка.` },
  );
  notification.on("click", () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("deploy:open-project", { projectId });
  });
  notification.show();
}

async function runDeploy(
  projectId: string,
  password: string | undefined,
  win: BrowserWindow,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  const server = getServer(project.serverId);
  const config = loadProjectConfig(project.path);

  const logWriter = new DeployLogWriter(config.name);
  const log = (line: string) => {
    logWriter.write(line);
    win.webContents.send("deploy:log", { projectId, line });
  };
  const startedAt = new Date().toISOString();

  const settings = readSettings();
  const conn = await connect(server, password);
  try {
    const result = await deployProject(conn, project.path, config, log, {
      letsEncryptEmail: settings.letsEncryptEmail || undefined,
    });
    // Порт выбирается на сервере при первом деплое — закрепляем его в конфиге
    if (result.port && result.port !== config.port) {
      writeProjectConfig(project.path, { ...config, port: result.port });
    }
    appendHistory({
      project: config.name,
      host: server.host,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "success",
      url: result.url,
      logFile: logWriter.file,
    });
    if (settings.notifyOnDeploySuccess) {
      notifyDeployResult(win, projectId, config.name, true);
    }
    return { url: result.url };
  } catch (err) {
    const message = (err as Error).message;
    logWriter.write(`\nОШИБКА: ${message}`);
    appendHistory({
      project: config.name,
      host: server.host,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "error",
      error: message,
      logFile: logWriter.file,
    });
    notifyDeployResult(win, projectId, config.name, false);
    throw err;
  } finally {
    conn.close();
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: "Plantar",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}

// Без AppUserModelId уведомления на Windows не показываются; должен совпадать с appId сборки
if (process.platform === "win32") app.setAppUserModelId("com.plantar.desktop");

app.whenReady().then(() => {
  migratePlainKeys();
  const win = createWindow();

  ipcMain.handle("settings:get", () => toResult(async () => readSettings()));
  ipcMain.handle("settings:set", (_e, settings: AppSettings) =>
    toResult(async () => {
      writeSettings(settings);
    }),
  );

  ipcMain.handle("servers:list", () => toResult(async () => readServers()));
  ipcMain.handle("servers:add", (_e, input: AddServerInput) => toResult(() => addServer(input)));
  ipcMain.handle("servers:remove", (_e, id: string) =>
    toResult(async () => {
      writeServers(readServers().filter((s) => s.id !== id));
      writeProjects(readProjects().filter((p) => p.serverId !== id));
    }),
  );

  ipcMain.handle("projects:list", () => toResult(async () => readProjects()));
  ipcMain.handle("projects:pick", () => toResult(() => pickProjectFolder(win)));
  ipcMain.handle("projects:add", (_e, input: AddProjectInput) =>
    toResult(async () => addProject(input)),
  );
  ipcMain.handle("projects:remove", (_e, id: string) =>
    toResult(async () => {
      writeProjects(readProjects().filter((p) => p.id !== id));
    }),
  );
  ipcMain.handle(
    "projects:removeFromServer",
    (_e, args: { projectId: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        // Имя могли поменять в plantar.json — берём актуальное, с фолбэком
        let name = project.name;
        try {
          name = loadProjectConfig(project.path).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const conn = await connect(server, args.password);
        try {
          await removeDeployedProject(conn, name);
        } finally {
          conn.close();
        }
      }),
  );
  ipcMain.handle("projects:readConfig", (_e, projectId: string) =>
    toResult(async () => loadProjectConfig(getProject(projectId).path)),
  );
  ipcMain.handle("projects:writeConfig", (_e, args: { projectId: string; config: ProjectConfigInput }) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      assertNameFreeOnServer(project.serverId, args.config.name, project.id);
      const config = writeProjectConfig(project.path, args.config);
      if (config.name !== project.name) {
        writeProjects(
          readProjects().map((p) => (p.id === project.id ? { ...p, name: config.name } : p)),
        );
      }
      return config;
    }),
  );

  // Переменные проекта хранятся на сервере (вне папки релиза) и применяются при деплое
  ipcMain.handle("env:read", (_e, args: { projectId: string; password?: string }) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      const config = loadProjectConfig(project.path);
      const conn = await connect(getServer(project.serverId), args.password);
      try {
        return await readProjectEnv(conn, config.name);
      } finally {
        conn.close();
      }
    }),
  );
  ipcMain.handle(
    "env:write",
    (_e, args: { projectId: string; content: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const config = loadProjectConfig(project.path);
        const conn = await connect(getServer(project.serverId), args.password);
        try {
          await writeProjectEnv(conn, config.name, args.content);
        } finally {
          conn.close();
        }
      }),
  );

  // Локальные .env-файлы из папки проекта — только на чтение, для импорта на сервер
  const ENV_FILE_RE = /^\.env[\w.-]*$/;
  ipcMain.handle("env:listLocal", (_e, projectId: string) =>
    toResult(async () =>
      readdirSync(getProject(projectId).path)
        .filter((f) => ENV_FILE_RE.test(f))
        .sort(),
    ),
  );
  ipcMain.handle("env:readLocal", (_e, args: { projectId: string; file: string }) =>
    toResult(async () => {
      if (!ENV_FILE_RE.test(args.file)) throw new Error("Недопустимое имя env-файла.");
      return readFileSync(path.join(getProject(args.projectId).path, args.file), "utf8");
    }),
  );

  ipcMain.handle("history:list", (_e, projectId: string) =>
    toResult(async () => {
      const project = getProject(projectId);
      const server = getServer(project.serverId);
      // Имя сайта могли поменять в plantar.json — берём актуальное, с фолбэком
      let name = project.name;
      try {
        name = loadProjectConfig(project.path).name;
      } catch {
        /* plantar.json недоступен — используем имя на момент добавления */
      }
      return readHistory()
        .filter((r) => r.project === name && r.host === server.host)
        .reverse();
    }),
  );
  ipcMain.handle("history:readLog", (_e, logFile: string) =>
    toResult(async () => {
      // Читаем только файлы из хранилища логов Plantar
      const logsRoot = path.join(dataDir(), "logs") + path.sep;
      const resolved = path.resolve(logFile);
      if (!resolved.startsWith(logsRoot)) {
        throw new Error("Недопустимый путь к файлу лога.");
      }
      return readFileSync(resolved, "utf8");
    }),
  );

  ipcMain.handle("server:info", (_e, args: { serverId: string; password?: string }) =>
    toResult(async () => {
      const conn = await connect(getServer(args.serverId), args.password);
      try {
        return await getServerInfo(conn);
      } finally {
        conn.close();
      }
    }),
  );

  ipcMain.handle("deploy:run", (_e, args: { projectId: string; password?: string }) =>
    toResult(() => runDeploy(args.projectId, args.password, win)),
  );

  ipcMain.handle("logs:get", (_e, args: { projectId: string; password?: string }) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      const conn = await connect(getServer(project.serverId), args.password);
      try {
        const logs = await getSiteLogs(conn, project.name, 200);
        if (readSettings().saveServerLogCopies) {
          saveServerLogSnapshot(project.name, "access", logs.access);
          saveServerLogSnapshot(project.name, "error", logs.error);
        }
        return logs;
      } finally {
        conn.close();
      }
    }),
  );

  ipcMain.handle("open-external", (_e, url: string) => shell.openExternal(url));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
