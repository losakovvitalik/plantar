import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from "electron";
import { SshConnection } from "@plantar/ssh";
import {
  type LogStreamSource,
  deployProject,
  discoverApps,
  getServerInfo,
  logStreamCommand,
  pm2ProcessStatuses,
  readProjectEnv,
  removeDeployedProject,
  rollbackProject,
  writeProjectEnv,
} from "@plantar/core";
import {
  type ProjectConfig,
  type ProjectConfigInput,
  detectProjectConfig,
  hasProjectConfig,
  loadProjectConfig,
  parseProjectConfig,
  writeProjectConfig,
} from "@plantar/config";
import {
  DeployLogWriter,
  type AppStatus,
  type ProjectRecord,
  type ServerRecord,
  type AppSettings,
  type DeployRecord,
  appendHistory,
  dataDir,
  readAppStatusCache,
  readCommitsCache,
  readHistory,
  readProjects,
  readServers,
  readSettings,
  reposDir,
  saveServerLogSnapshot,
  writeAppStatusCache,
  writeCommitsCache,
  writeProjects,
  writeServers,
  writeSettings,
} from "@plantar/storage";
import {
  generateKeyPair,
  installPublicKey,
  loadPrivateKey,
  migratePlainKeys,
  removeKeysWithComment,
  storePrivateKey,
} from "./ssh-setup";
import { dropConnection, isConnected, withPooledConnection } from "./ssh-pool";
import {
  assertValidBranch,
  cloneRepo,
  headCommit,
  listCommits,
  listRemoteBranches,
  updateRepo,
} from "./git";
import {
  getAccount,
  getToken,
  pollDeviceLogin,
  signOut,
  startDeviceLogin,
} from "./github";
import {
  WORKFLOW_PATH,
  buildWorkflowYaml,
  commitFiles,
  fetchSecretsPublicKey,
  parseGithubRepo,
  putSecrets,
} from "./github-actions";
import { setLanguage, t } from "./i18n";

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
  if (!server) throw new Error(t("serverNotFound"));
  return server;
}

function getProject(id: string): ProjectRecord {
  const project = readProjects().find((p) => p.id === id);
  if (!project) throw new Error(t("projectNotFound"));
  return project;
}

/** Эффективная папка проекта: клон/папка + подпапка (для монорепозиториев) */
function projectDir(project: Pick<ProjectRecord, "path" | "subdir">): string {
  return project.subdir ? path.join(project.path, project.subdir) : project.path;
}

/** Конфиг проекта: у импортированных без папки живёт в записи, иначе — plantar.json */
function projectConfig(project: ProjectRecord): ProjectConfig {
  if (project.external && !project.path) {
    return parseProjectConfig(project.external.config);
  }
  return loadProjectConfig(projectDir(project));
}

/** Записи истории деплоев проекта, новыми вперёд (имя берём из plantar.json, с фолбэком) */
function projectHistory(project: ProjectRecord): DeployRecord[] {
  const server = getServer(project.serverId);
  let name = project.name;
  try {
    name = projectConfig(project).name;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
  }
  return readHistory()
    .filter((r) => r.project === name && r.host === server.host)
    .reverse();
}

/** Статус приложения проекта по карте pm2-процессов сервера (имя → статус) */
function appStatusOf(project: ProjectRecord, pm2: Map<string, string>): AppStatus {
  let name = project.name;
  let type: string | undefined;
  try {
    const config = projectConfig(project);
    name = config.name;
    type = config.type;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
  }
  // Статичный сайт живёт без pm2-процесса — живой проверки для него нет
  if (type === "static") return "static";
  // Внешнее приложение до первого деплоя работает под прежним именем pm2
  const status = pm2.get(project.external ? project.external.pm2Name : name);
  if (status === "online" || status === "launching") return "running";
  if (status === "errored") return "error";
  return "stopped";
}

/**
 * Нормализует подпапку в repo-относительный POSIX-путь и проверяет, что она
 * существует внутри root и является директорией. Возвращает "" для корня.
 */
function resolveSubdir(root: string, subdir: string | undefined): string {
  const clean = (subdir ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean === ".") return "";
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(t("subdirOutside"));
  }
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new Error(t("subdirMissing", { subdir: clean }));
  }
  return clean;
}

async function connect(server: ServerRecord, password?: string): Promise<SshConnection> {
  if (server.auth === "password" && !password) {
    throw new Error(t("passwordRequired"));
  }
  return SshConnection.connect({
    host: server.host,
    port: server.port,
    username: server.user,
    password: server.auth === "password" ? password : undefined,
    privateKey: server.auth === "key" ? loadPrivateKey(server.keyPath!) : undefined,
  });
}

/** Операция на соединении из пула: живое переиспользуется, пароль нужен только для нового */
const withServer = <T>(
  server: ServerRecord,
  password: string | undefined,
  fn: (conn: SshConnection) => Promise<T>,
): Promise<T> => withPooledConnection(server.id, () => connect(server, password), fn);

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
  if (!password) throw new Error(t("enterPassword"));
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
    title: t("pickProjectFolder"),
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
  /** Подпапка внутри path, где лежит проект (монорепозитории); пусто — корень */
  subdir?: string;
  /** git — path указывает на клон в reposDir(); local — обычная папка */
  source?: "local" | "git";
  repoUrl?: string;
  branch?: string;
}

/** Два проекта с одним name на одном сервере деплоились бы в один /var/www/<name> */
function assertNameFreeOnServer(serverId: string, name: string, excludeProjectId?: string): void {
  const clash = readProjects().find((p) => {
    if (p.serverId !== serverId || p.id === excludeProjectId) return false;
    let existingName = p.name;
    try {
      existingName = projectConfig(p).name;
    } catch {
      /* plantar.json недоступен — используем имя на момент добавления */
    }
    return existingName === name;
  });
  if (clash) {
    throw new Error(t("nameTaken", { name, path: clash.path }));
  }
}

interface ImportProjectInput {
  serverId: string;
  /** Настройки из формы импорта: имя, тип, рантайм, домен, порт */
  config: ProjectConfigInput;
  pm2Name: string;
  appDir: string;
  nginxConfFile?: string;
  outLogPath?: string;
  errLogPath?: string;
  accessLogPath?: string;
  errorLogPath?: string;
  repoUrl?: string;
  branch?: string;
  repoSubdir?: string;
}

/** Добавляет найденное на сервере приложение как внешний проект (без папки с кодом) */
function importProject(input: ImportProjectInput): ProjectRecord {
  getServer(input.serverId);
  const config = parseProjectConfig(input.config);
  assertNameFreeOnServer(input.serverId, config.name);
  const record: ProjectRecord = {
    id: randomUUID(),
    serverId: input.serverId,
    name: config.name,
    path: "",
    external: {
      pm2Name: input.pm2Name,
      appDir: input.appDir,
      nginxConfFile: input.nginxConfFile,
      outLogPath: input.outLogPath,
      errLogPath: input.errLogPath,
      accessLogPath: input.accessLogPath,
      errorLogPath: input.errorLogPath,
      repoUrl: input.repoUrl,
      branch: input.branch,
      repoSubdir: input.repoSubdir,
      config: {
        name: config.name,
        type: config.type,
        runtime: config.runtime,
        domain: config.domain,
        port: config.port,
      },
    },
  };
  writeProjects([...readProjects(), record]);
  return record;
}

function addProject(input: AddProjectInput): ProjectRecord {
  getServer(input.serverId);
  const subdir = resolveSubdir(input.path, input.subdir);
  const dir = subdir ? path.join(input.path, subdir) : input.path;
  const parsedConfig = input.config ? null : loadProjectConfig(dir);
  assertNameFreeOnServer(input.serverId, (input.config ?? parsedConfig!).name);
  const config = input.config ? writeProjectConfig(dir, input.config) : parsedConfig!;
  const record: ProjectRecord = {
    id: randomUUID(),
    serverId: input.serverId,
    name: config.name,
    path: input.path,
    ...(subdir ? { subdir } : {}),
    ...(input.source === "git"
      ? { source: "git" as const, repoUrl: input.repoUrl, branch: input.branch }
      : {}),
  };
  writeProjects([...readProjects(), record]);
  return record;
}

/** Клонирует репозиторий в reposDir() и предзаполняет настройки — как выбор папки */
async function cloneRepoForProject(repoUrl: string, branch: string) {
  const dir = path.join(reposDir(), randomUUID());
  await cloneRepo(repoUrl, branch || undefined, dir, getToken() ?? undefined);
  return {
    path: dir,
    config: hasProjectConfig(dir) ? loadProjectConfig(dir) : null,
    detected: detectProjectConfig(dir),
  };
}

/**
 * Выбор подпапки проекта внутри клона: открывает диалог в корне клона,
 * возвращает repo-относительный путь и настройки, определённые в этой папке.
 */
async function pickSubdir(win: BrowserWindow, root: string) {
  const reposRoot = reposDir() + path.sep;
  if (!path.resolve(root).startsWith(reposRoot)) throw new Error(t("subdirOutside"));

  const picked = await dialog.showOpenDialog(win, {
    title: t("pickProjectFolder"),
    defaultPath: root,
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;

  const subdir = resolveSubdir(root, path.relative(root, picked.filePaths[0]));
  const dir = subdir ? path.join(root, subdir) : root;
  return {
    subdir,
    config: hasProjectConfig(dir) ? loadProjectConfig(dir) : null,
    detected: detectProjectConfig(dir),
  };
}

/** Удаляет клон git-проекта; трогает только папки внутри reposDir() */
function removeCloneDir(projectPath: string): void {
  const root = reposDir() + path.sep;
  if (path.resolve(projectPath).startsWith(root)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
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
      ? {
          title: t("notifySuccessTitle"),
          body: t("notifySuccessBody", { name: projectName }),
        }
      : {
          title: t("notifyErrorTitle"),
          body: t("notifyErrorBody", { name: projectName }),
        },
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
  // Импортированный проект: деплой возможен только после привязки папки с кодом
  if (project.external && !project.path) throw new Error(t("externalNeedsFolder"));
  const dir = projectDir(project);
  let config = loadProjectConfig(dir);

  const logWriter = new DeployLogWriter(config.name);
  const log = (line: string) => {
    logWriter.write(line);
    win.webContents.send("deploy:log", { projectId, line });
  };
  const startedAt = new Date().toISOString();

  // git-проект: обновляем клон до свежего коммита ветки перед деплоем
  let deployedCommit: { hash: string; message: string } | undefined;
  if (project.source === "git") {
    log(t("deployUpdatingRepo"));
    await updateRepo(project.path, project.branch!, getToken() ?? undefined);
    // plantar.json лежит untracked и переживает reset; на всякий случай восстанавливаем конфиг
    config = writeProjectConfig(dir, config);
    // Коммит фиксируем до сборки — он нужен и в успешной, и в упавшей записи истории
    try {
      deployedCommit = await headCommit(project.path);
    } catch {
      /* не смогли прочитать коммит — деплой всё равно продолжаем */
    }
  }

  const settings = readSettings();
  return withServer(server, password, async (conn) => {
    try {
      const result = await deployProject(conn, dir, config, log, {
        letsEncryptEmail: settings.letsEncryptEmail || undefined,
        // Первый деплой импортированного проекта снимает прежний процесс и конфиг nginx
        takeover: project.external
          ? {
              pm2Name: project.external.pm2Name,
              nginxConfFile: project.external.nginxConfFile,
            }
          : undefined,
      });
      // Порт выбирается на сервере при первом деплое — закрепляем его в конфиге
      if (result.port && result.port !== config.port) {
        writeProjectConfig(dir, { ...config, port: result.port });
      }
      appendHistory({
        project: config.name,
        host: server.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "success",
        url: result.url,
        commit: deployedCommit?.hash,
        logFile: logWriter.file,
      });
      // git-проект: запоминаем задеплоенный коммит для карточки проекта и вкладки «Коммиты»
      // Внешний проект после успешного деплоя переходит на управляемую структуру —
      // пометка «внешний» снимается, дальше он живёт как обычный проект
      if (deployedCommit || project.external) {
        const commit = deployedCommit;
        writeProjects(
          readProjects().map((p) =>
            p.id === project.id
              ? { ...p, ...(commit ? { deployedCommit: commit } : {}), external: undefined }
              : p,
          ),
        );
      }
      if (settings.notifyOnDeploySuccess) {
        notifyDeployResult(win, projectId, config.name, true);
      }
      return { url: result.url };
    } catch (err) {
      const message = (err as Error).message;
      logWriter.write(`\n${t("deployLogError")}: ${message}`);
      appendHistory({
        project: config.name,
        host: server.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        error: message,
        commit: deployedCommit?.hash,
        logFile: logWriter.file,
      });
      notifyDeployResult(win, projectId, config.name, false);
      throw err;
    }
  });
}

/** Возврат предыдущей версии; лог идёт в тот же канал, что и лог деплоя */
async function runRollback(
  projectId: string,
  password: string | undefined,
  win: BrowserWindow,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  // До первого деплоя через Plantar на сервере нет сохранённых версий
  if (project.external) throw new Error(t("rollbackUnavailableExternal"));
  const server = getServer(project.serverId);
  const config = projectConfig(project);

  const logWriter = new DeployLogWriter(config.name);
  const log = (line: string) => {
    logWriter.write(line);
    win.webContents.send("deploy:log", { projectId, line });
  };
  const startedAt = new Date().toISOString();

  return withServer(server, password, async (conn) => {
    try {
      const result = await rollbackProject(conn, config, log);
      appendHistory({
        project: config.name,
        host: server.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "success",
        kind: "rollback",
        url: result.url,
        logFile: logWriter.file,
      });
      return { url: result.url };
    } catch (err) {
      const message = (err as Error).message;
      logWriter.write(`\n${t("deployLogError")}: ${message}`);
      appendHistory({
        project: config.name,
        host: server.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        kind: "rollback",
        error: message,
        logFile: logWriter.file,
      });
      throw err;
    }
  });
}

/**
 * Настраивает деплой при коммите: генерирует отдельный deploy-ключ (личный ключ
 * пользователя не используется), устанавливает его на сервер, кладёт ключ и адрес
 * сервера в Secrets репозитория и коммитит workflow + plantar.json в ветку проекта.
 * Ключ и адрес уходят в GitHub Secrets — осознанное исключение из local-first (README).
 */
async function setupGithubActions(
  projectId: string,
  password: string | undefined,
): Promise<{ branch: string; actionsUrl: string }> {
  const project = getProject(projectId);
  if (project.source !== "git" || !project.repoUrl || !project.branch) {
    throw new Error(t("actionsGitOnly"));
  }
  const token = getToken();
  const account = getAccount();
  if (!token || !account) throw new Error(t("actionsLoginRequired"));
  // Без права workflow GitHub отклонит коммит файла автодеплоя — проверяем до правок
  if (!account.canWriteWorkflows) throw new Error(t("actionsScopeMissing"));
  assertValidBranch(project.branch);
  const repo = parseGithubRepo(project.repoUrl);
  const server = getServer(project.serverId);
  const dir = projectDir(project);
  const config = loadProjectConfig(dir);

  // Ключ шифрования секретов доступен только администратору репозитория: запрашиваем
  // его первым, чтобы при нехватке прав не оставить на сервере лишний ключ
  const secretsKey = await fetchSecretsPublicKey(token, repo);

  // Ключ проекта опознаётся по комментарию: прежний снимаем — его приватная
  // половина лежала в секретах репозитория и больше не должна открывать сервер
  const comment = `plantar-ci-${config.name}`;
  const { privateKeyPem, publicKey } = await generateKeyPair(
    `github-actions-${project.id}`,
    comment,
  );
  await withServer(server, password, async (conn) => {
    await removeKeysWithComment(conn, comment);
    await installPublicKey(conn, publicKey);
  });

  await putSecrets(token, repo, secretsKey, {
    PLANTAR_SSH_KEY: privateKeyPem,
    PLANTAR_HOST: server.host,
    PLANTAR_PORT: String(server.port),
    PLANTAR_USER: server.user,
  });

  // plantar.json лежит в клоне untracked — без него CI не поймёт, как деплоить
  const configPath = project.subdir ? `${project.subdir}/plantar.json` : "plantar.json";
  await commitFiles(
    token,
    repo,
    project.branch,
    [
      { path: WORKFLOW_PATH, content: buildWorkflowYaml(project.branch, config, project.subdir) },
      { path: configPath, content: readFileSync(path.join(dir, "plantar.json"), "utf8") },
    ],
    "ci: deploy with Plantar on push",
  );

  return {
    branch: project.branch,
    actionsUrl: `https://github.com/${repo.owner}/${repo.repo}/actions`,
  };
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
  setLanguage(readSettings().language);
  migratePlainKeys();
  const win = createWindow();

  ipcMain.handle("settings:get", () => toResult(async () => readSettings()));
  ipcMain.handle("settings:set", (_e, settings: AppSettings) =>
    toResult(async () => {
      writeSettings(settings);
      setLanguage(settings.language);
    }),
  );

  // GitHub Device Flow: вход без backend, токен шифруется safeStorage
  ipcMain.handle("github:account", () => toResult(async () => getAccount()));
  ipcMain.handle("github:startLogin", () => toResult(() => startDeviceLogin()));
  ipcMain.handle(
    "github:pollLogin",
    (_e, args: { deviceCode: string; interval: number; expiresIn: number }) =>
      toResult(() => pollDeviceLogin(args.deviceCode, args.interval, args.expiresIn)),
  );
  ipcMain.handle("github:signOut", () => toResult(async () => signOut()));
  // Автонастройка деплоя при коммите: deploy-ключ → Secrets, workflow → в ветку
  ipcMain.handle("github:setupActions", (_e, args: { projectId: string; password?: string }) =>
    toResult(() => setupGithubActions(args.projectId, args.password)),
  );

  ipcMain.handle("servers:list", () => toResult(async () => readServers()));
  ipcMain.handle("servers:add", (_e, input: AddServerInput) => toResult(() => addServer(input)));
  ipcMain.handle("servers:remove", (_e, id: string) =>
    toResult(async () => {
      dropConnection(id);
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

  ipcMain.handle("projects:list", () => toResult(async () => readProjects()));
  ipcMain.handle("projects:pick", () => toResult(() => pickProjectFolder(win)));
  // Список веток репозитория для выпадающего списка в форме добавления
  ipcMain.handle("repo:branches", (_e, repoUrl: string) =>
    toResult(() => listRemoteBranches(repoUrl, getToken() ?? undefined)),
  );
  // Клонирует репозиторий локально и возвращает предзаполненные настройки
  ipcMain.handle("projects:cloneRepo", (_e, args: { repoUrl: string; branch: string }) =>
    toResult(() => cloneRepoForProject(args.repoUrl, args.branch)),
  );
  // Пользователь закрыл форму, не добавив проект — убираем осиротевший клон
  ipcMain.handle("projects:cancelClone", (_e, clonePath: string) =>
    toResult(async () => removeCloneDir(clonePath)),
  );
  ipcMain.handle("projects:add", (_e, input: AddProjectInput) =>
    toResult(async () => addProject(input)),
  );
  // Обнаружение приложений, запущенных на сервере до подключения Plantar
  ipcMain.handle("server:discover", (_e, args: { serverId: string; password?: string }) =>
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
  ipcMain.handle("projects:import", (_e, input: ImportProjectInput) =>
    toResult(async () => importProject(input)),
  );
  // Привязка папки с кодом к импортированному проекту: создаёт plantar.json
  // из настроек, подтверждённых при импорте, поверх автоопределённых по папке
  ipcMain.handle("projects:linkFolder", (_e, projectId: string) =>
    toResult(async () => {
      const project = getProject(projectId);
      if (!project.external || project.path) throw new Error(t("linkFolderUnavailable"));
      const picked = await dialog.showOpenDialog(win, {
        title: t("pickProjectFolder"),
        properties: ["openDirectory"],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const dir = picked.filePaths[0];
      const base = hasProjectConfig(dir)
        ? loadProjectConfig(dir)
        : detectProjectConfig(dir).config;
      const config = writeProjectConfig(dir, { ...base, ...project.external.config });
      const updated = readProjects().map((p) =>
        p.id === projectId ? { ...p, path: dir } : p,
      );
      writeProjects(updated);
      return { project: updated.find((p) => p.id === projectId)!, config };
    }),
  );
  // Подключение GitHub-репозитория к импортированному проекту: клонирует репозиторий,
  // из которого приложение было задеплоено на сервер, и переводит проект в git-источник
  ipcMain.handle("projects:linkRepo", (_e, projectId: string) =>
    toResult(async () => {
      const project = getProject(projectId);
      const repoUrl = project.external?.repoUrl;
      if (!project.external || project.path || !repoUrl) {
        throw new Error(t("linkRepoUnavailable"));
      }
      // Ветку сервера могли удалить или HEAD был отвязан — берём ветку по умолчанию
      const branch =
        project.external.branch ??
        (await listRemoteBranches(repoUrl, getToken() ?? undefined)).default;
      const cloneDir = path.join(reposDir(), randomUUID());
      await cloneRepo(repoUrl, branch, cloneDir, getToken() ?? undefined);
      try {
        const subdir = resolveSubdir(cloneDir, project.external.repoSubdir);
        const dir = subdir ? path.join(cloneDir, subdir) : cloneDir;
        const base = hasProjectConfig(dir)
          ? loadProjectConfig(dir)
          : detectProjectConfig(dir).config;
        const config = writeProjectConfig(dir, { ...base, ...project.external.config });
        const updated = readProjects().map((p) =>
          p.id === projectId
            ? {
                ...p,
                path: cloneDir,
                subdir: subdir || undefined,
                source: "git" as const,
                repoUrl,
                branch,
              }
            : p,
        );
        writeProjects(updated);
        return { project: updated.find((p) => p.id === projectId)!, config };
      } catch (err) {
        // Подключение не удалось (например, папки приложения нет в репозитории) —
        // не оставляем осиротевший клон
        rmSync(cloneDir, { recursive: true, force: true });
        throw err;
      }
    }),
  );
  ipcMain.handle("projects:remove", (_e, id: string) =>
    toResult(async () => {
      const project = readProjects().find((p) => p.id === id);
      if (project?.source === "git") removeCloneDir(project.path);
      writeProjects(readProjects().filter((p) => p.id !== id));
      // Убираем осиротевший снимок кэша коммитов
      const cache = readCommitsCache();
      if (id in cache) {
        delete cache[id];
        writeCommitsCache(cache);
      }
    }),
  );
  // Кэш вкладки «Коммиты»: мгновенный показ устаревшего снимка при открытии
  ipcMain.handle("git:commitsCache", (_e, projectId: string) =>
    toResult(async () => readCommitsCache()[projectId] ?? null),
  );
  // Свежий снимок: коммиты ветки (сетевой git fetch) + статусы деплоев; пишем в кэш
  ipcMain.handle("git:commitsView", (_e, projectId: string) =>
    toResult(async () => {
      const project = getProject(projectId);
      if (project.source !== "git") return { commits: [], history: [] };
      const commits = await listCommits(
        project.path,
        project.branch!,
        getToken() ?? undefined,
      );
      const history = projectHistory(project);
      const cache = readCommitsCache();
      cache[projectId] = { commits, history, cachedAt: new Date().toISOString() };
      writeCommitsCache(cache);
      return { commits, history };
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
          name = loadProjectConfig(projectDir(project)).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        await withServer(server, args.password, (conn) => removeDeployedProject(conn, name));
      }),
  );
  ipcMain.handle("projects:readConfig", (_e, projectId: string) =>
    toResult(async () => projectConfig(getProject(projectId))),
  );
  // Открывает выбор подпапки внутри клона и определяет настройки в ней
  ipcMain.handle("projects:pickSubdir", (_e, root: string) =>
    toResult(() => pickSubdir(win, root)),
  );
  ipcMain.handle(
    "projects:writeConfig",
    (_e, args: { projectId: string; config: ProjectConfigInput; subdir?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        // Импортированный проект без папки: plantar.json ещё нет,
        // настройки живут в записи проекта
        if (project.external && !project.path) {
          const config = parseProjectConfig(args.config);
          assertNameFreeOnServer(project.serverId, config.name, project.id);
          const external = {
            ...project.external,
            config: {
              name: config.name,
              type: config.type,
              runtime: config.runtime,
              domain: config.domain,
              port: config.port,
            },
          };
          writeProjects(
            readProjects().map((p) =>
              p.id === project.id ? { ...p, name: config.name, external } : p,
            ),
          );
          return config;
        }
        // subdir применим только к git-проектам; для локальных остаётся как был
        const subdir =
          project.source === "git"
            ? resolveSubdir(project.path, args.subdir ?? project.subdir)
            : (project.subdir ?? "");
        const dir = subdir ? path.join(project.path, subdir) : project.path;
        assertNameFreeOnServer(project.serverId, args.config.name, project.id);
        const config = writeProjectConfig(dir, args.config);
        if (config.name !== project.name || subdir !== (project.subdir ?? "")) {
          writeProjects(
            readProjects().map((p) =>
              p.id === project.id
                ? { ...p, name: config.name, subdir: subdir || undefined }
                : p,
            ),
          );
        }
        return config;
      }),
  );
  // Смена ветки git-проекта: сразу переключаем локальный клон, чтобы подпапка
  // и настройки читались из выбранной ветки, а не только со следующего деплоя
  ipcMain.handle(
    "projects:setBranch",
    (_e, args: { projectId: string; branch: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        if (project.source !== "git" || !project.path) {
          throw new Error(t("branchNotGit"));
        }
        assertValidBranch(args.branch);
        await updateRepo(project.path, args.branch, getToken() ?? undefined);
        writeProjects(
          readProjects().map((p) =>
            p.id === project.id ? { ...p, branch: args.branch } : p,
          ),
        );
      }),
  );

  // Переменные проекта хранятся на сервере (вне папки версии) и применяются при деплое
  ipcMain.handle("env:read", (_e, args: { projectId: string; password?: string }) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      const config = projectConfig(project);
      return withServer(getServer(project.serverId), args.password, (conn) =>
        readProjectEnv(conn, config.name),
      );
    }),
  );
  ipcMain.handle(
    "env:write",
    (_e, args: { projectId: string; content: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const config = projectConfig(project);
        await withServer(getServer(project.serverId), args.password, (conn) =>
          writeProjectEnv(conn, config.name, args.content),
        );
      }),
  );

  // Локальные .env-файлы из папки проекта — только на чтение, для импорта на сервер
  const ENV_FILE_RE = /^\.env[\w.-]*$/;
  ipcMain.handle("env:listLocal", (_e, projectId: string) =>
    toResult(async () => {
      const project = getProject(projectId);
      // У импортированного проекта без папки локальных файлов нет
      if (!project.path) return [];
      return readdirSync(projectDir(project))
        .filter((f) => ENV_FILE_RE.test(f))
        .sort();
    }),
  );
  ipcMain.handle("env:readLocal", (_e, args: { projectId: string; file: string }) =>
    toResult(async () => {
      if (!ENV_FILE_RE.test(args.file)) throw new Error(t("invalidEnvFileName"));
      return readFileSync(path.join(projectDir(getProject(args.projectId)), args.file), "utf8");
    }),
  );

  ipcMain.handle("history:list", (_e, projectId: string) =>
    toResult(async () => projectHistory(getProject(projectId))),
  );
  ipcMain.handle("history:readLog", (_e, logFile: string) =>
    toResult(async () => {
      // Читаем только файлы из хранилища логов Plantar
      const logsRoot = path.join(dataDir(), "logs") + path.sep;
      const resolved = path.resolve(logFile);
      if (!resolved.startsWith(logsRoot)) {
        throw new Error(t("invalidLogPath"));
      }
      return readFileSync(resolved, "utf8");
    }),
  );

  ipcMain.handle("server:info", (_e, args: { serverId: string; password?: string }) =>
    toResult(async () =>
      withServer(getServer(args.serverId), args.password, (conn) => getServerInfo(conn)),
    ),
  );
  ipcMain.handle("server:isConnected", (_e, serverId: string) =>
    toResult(async () => isConnected(serverId)),
  );
  // Статусы приложений сервера одним pm2-запросом; снимок кэшируется
  // для мгновенного показа при следующем открытии приложения
  ipcMain.handle("server:appStatuses", (_e, args: { serverId: string }) =>
    toResult(async () => {
      const server = getServer(args.serverId);
      const pm2 = await withServer(server, undefined, (conn) => pm2ProcessStatuses(conn));
      const apps: Record<string, AppStatus> = {};
      for (const project of readProjects().filter((p) => p.serverId === args.serverId)) {
        apps[project.id] = appStatusOf(project, pm2);
      }
      const entry = { apps, checkedAt: new Date().toISOString() };
      const cache = readAppStatusCache();
      cache[args.serverId] = entry;
      writeAppStatusCache(cache);
      return entry;
    }),
  );
  // Кэш статусов прошлой проверки — показывается сразу, пока идёт живая
  ipcMain.handle("server:appStatusesCache", () =>
    toResult(async () => readAppStatusCache()),
  );

  ipcMain.handle("deploy:run", (_e, args: { projectId: string; password?: string }) =>
    toResult(() => runDeploy(args.projectId, args.password, win)),
  );
  ipcMain.handle("deploy:rollback", (_e, args: { projectId: string; password?: string }) =>
    toResult(() => runRollback(args.projectId, args.password, win)),
  );

  // Живые лог-стримы: id → остановка. Активный стрим держит соединение в пуле занятым
  const logStreams = new Map<string, () => void>();
  // При перезагрузке renderer подписчики пропадают — останавливаем осиротевшие стримы
  win.webContents.on("did-navigate", () => {
    for (const stop of logStreams.values()) stop();
  });

  ipcMain.handle(
    "logs:streamStart",
    (_e, args: { projectId: string; source: LogStreamSource; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        // Имя могли поменять в plantar.json — берём актуальное, с фолбэком
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        // Импортированное приложение пишет логи по своим путям, пока Plantar
        // не пересоздаст процесс при первом деплое
        const external = project.external;
        const logPaths =
          external && args.source === "app" && external.outLogPath && external.errLogPath
            ? { out: external.outLogPath, err: external.errLogPath }
            : external && args.source === "nginx"
              ? {
                  out: external.accessLogPath ?? "/var/log/nginx/access.log",
                  err: external.errorLogPath ?? "/var/log/nginx/error.log",
                }
              : undefined;

        const streamId = randomUUID();
        const send = (channel: string, payload: unknown) => {
          if (!win.isDestroyed()) win.webContents.send(channel, payload);
        };
        // Просмотренные nginx-логи сохраняются локально при закрытии стрима (настройка)
        const snapshot =
          args.source === "nginx" && readSettings().saveServerLogCopies
            ? { access: "", error: "" }
            : null;
        const collect = (kind: "access" | "error", text: string) => {
          if (snapshot) snapshot[kind] = (snapshot[kind] + text).slice(-512_000);
        };

        await new Promise<void>((started, failed) => {
          // Внутренний промис резолвится при закрытии стрима — до этого соединение занято
          withServer(server, args.password, (conn) =>
            new Promise<void>((closed) => {
              conn
                .execStream(logStreamCommand(args.source, name, 200, logPaths), {
                  onStdout: (text) => {
                    collect("access", text);
                    send("logs:stream-data", { streamId, channel: "out", text });
                  },
                  onStderr: (text) => {
                    collect("error", text);
                    send("logs:stream-data", { streamId, channel: "err", text });
                  },
                  onClose: () => {
                    logStreams.delete(streamId);
                    if (snapshot) {
                      saveServerLogSnapshot(name, "access", snapshot.access);
                      saveServerLogSnapshot(name, "error", snapshot.error);
                    }
                    send("logs:stream-end", { streamId });
                    closed();
                  },
                })
                .then((handle) => {
                  logStreams.set(streamId, handle.stop);
                  started();
                })
                .catch((err) => {
                  closed();
                  failed(err);
                });
            }),
          ).catch(failed);
        });
        return { streamId };
      }),
  );

  ipcMain.handle("logs:streamStop", (_e, streamId: string) =>
    toResult(async () => {
      logStreams.get(streamId)?.();
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
