import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from "electron";
import { SshConnection } from "@plantar/ssh";
import {
  type LogStreamSource,
  type MonitoringTool,
  type RelatedFileId,
  appBaseDir,
  checkSitesRespond,
  deployExternalInPlace,
  deployProject,
  discoverApps,
  getExternalSyncState,
  getExternalVersions,
  enableAppMetrics,
  ensureAppMetricsScript,
  getAppLogActivity,
  getAppMetricsHistory,
  getMonitoringStatus,
  getServerInfo,
  getRelatedFiles,
  getServerMetrics,
  getTrafficStats,
  installMonitoringTool,
  listProjectDir,
  logStreamCommand,
  nginxRelatedPaths,
  pm2ProcessHealth,
  pm2ProcessStatuses,
  readAppEnv,
  readExternalEnv,
  readProjectEnv,
  readRemoteTextFile,
  removeDeployedProject,
  resolveProjectPath,
  rollbackProject,
  writeExternalEnv,
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
  type StatusTabCacheEntry,
  appendHistory,
  dataDir,
  deployLogTimestamp,
  listDeployLogs,
  readAppStatusCache,
  readCommitsCache,
  readHistory,
  readLogTail,
  readProjects,
  readServers,
  readSettings,
  readStatusTabCache,
  reposDir,
  resolveLastRun,
  saveServerLogSnapshot,
  writeAppStatusCache,
  writeCommitsCache,
  writeProjects,
  writeServers,
  writeSettings,
  writeStatusTabCache,
} from "@plantar/storage";
import {
  detectSshConfigHosts,
  detectUserSshKeys,
  generateKeyPair,
  installPublicKey,
  loadPrivateKey,
  looksLikePrivateKey,
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
import {
  type DeployRunState,
  activeDeployRuns,
  deployRunState,
  startDeployRun,
} from "./deploy-runs";
import { forgetServer, startAppMonitor, stopAppMonitor } from "./app-monitor";
import { createAppTray, destroyTray, refreshTrayMenu } from "./tray";

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function toResult<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // code — машинный код ошибки (например npm-peer-conflict); GUI по нему предлагает действие
    return { ok: false, error: (err as Error).message, code: (err as { code?: string }).code };
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

/** Корень файлов проекта на сервере: у импортированного — его папка, иначе /var/www/<имя> */
function projectRemoteRoot(project: ProjectRecord): string {
  if (project.external) return project.external.appDir;
  let name = project.name;
  try {
    name = projectConfig(project).name;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
  }
  return appBaseDir(name);
}

/** Абсолютный путь связанного nginx-файла; у внешних приложений и ботов nginx-файлов нет */
function relatedFilePath(project: ProjectRecord, id: RelatedFileId): string {
  if (project.external) throw new Error(t("fileNotFound"));
  const config = projectConfig(project);
  const found =
    config.type === "bot"
      ? undefined
      : nginxRelatedPaths(config.name).find((file) => file.id === id);
  if (!found) throw new Error(t("fileNotFound"));
  return found.path;
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

/** Статус приложения проекта по карте pm2-процессов сервера (имя → статус)
 *  и адрес сайта для живой HTTP-проверки (у ботов и без конфига адреса нет) */
function appStatusOf(
  project: ProjectRecord,
  pm2: Map<string, string>,
  host: string,
): { status: AppStatus; siteUrl?: string } {
  let name = project.name;
  let type: string | undefined;
  let domain: string | undefined;
  try {
    const config = projectConfig(project);
    name = config.name;
    type = config.type;
    domain = config.domain;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
  }
  // Тот же адрес, что проверяет смоук-тест после деплоя
  const siteUrl =
    type && type !== "bot"
      ? domain
        ? `https://${domain}/`
        : `http://${host}/`
      : undefined;
  // Статичный сайт живёт без pm2-процесса
  if (type === "static") return { status: "static", siteUrl };
  // Внешнее приложение работает под прежним именем pm2
  const status = pm2.get(project.external ? project.external.pm2Name : name);
  if (status === "online" || status === "launching") return { status: "running", siteUrl };
  if (status === "errored") return { status: "error", siteUrl };
  return { status: "stopped", siteUrl };
}

/**
 * Statuses of every app on a server in one SSH round trip: a batched
 * `pm2 jlist` plus parallel curl checks of the sites, on one pooled
 * connection. Used by the sidebar refresh and the background monitor; the
 * snapshot is cached for an instant display on the next app start.
 */
async function collectServerAppStatuses(
  server: ServerRecord,
): Promise<{ apps: Record<string, AppStatus>; checkedAt: string }> {
  const apps: Record<string, AppStatus> = {};
  // Сайт проверяем там, где он должен отвечать: у работающих приложений
  // и у статики, которая хотя бы раз успешно деплоилась
  const sites: { projectId: string; url: string }[] = [];
  await withServer(server, undefined, async (conn) => {
    const pm2 = await pm2ProcessStatuses(conn);
    for (const project of readProjects().filter((p) => p.serverId === server.id)) {
      const { status, siteUrl } = appStatusOf(project, pm2, server.host);
      apps[project.id] = status;
      const deployedStatic =
        status === "static" &&
        projectHistory(project).some((r) => r.status === "success");
      if (siteUrl && (status === "running" || deployedStatic)) {
        sites.push({ projectId: project.id, url: siteUrl });
      }
    }
    const responds = await checkSitesRespond(
      conn,
      sites.map((s) => s.url),
    );
    // Сайт отвечает — «работает» (в том числе статика), нет — «не отвечает»
    sites.forEach((s, i) => {
      apps[s.projectId] = responds[i] ? "running" : "unresponsive";
    });
  });
  const entry = { apps, checkedAt: new Date().toISOString() };
  const cache = readAppStatusCache();
  cache[server.id] = entry;
  writeAppStatusCache(cache);
  return entry;
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
  auth: "key" | "password" | "existing-key";
  /** Для auth=key используется один раз — чтобы установить ключ; не сохраняется */
  password: string;
  /** Для auth=existing-key: путь к готовому приватному ключу пользователя */
  keyPath?: string;
}

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
async function pickProjectFolder() {
  const win = activeWindow();
  if (!win) return null;
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
  /** Пароль сервера, если соединение из пула уже закрылось */
  password?: string;
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
async function importProject(input: ImportProjectInput): Promise<ProjectRecord> {
  // Called for the throw only: fail before writing a record for a removed server
  getServer(input.serverId);
  const config = parseProjectConfig(input.config);
  assertNameFreeOnServer(input.serverId, config.name);
  // Переменные не копируются в хранилище Plantar: внешний проект читает
  // и сохраняет их прямо в .env своей папки — на сервере ничего не меняется
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
async function pickSubdir(root: string) {
  const reposRoot = reposDir() + path.sep;
  if (!path.resolve(root).startsWith(reposRoot)) throw new Error(t("subdirOutside"));

  const win = activeWindow();
  if (!win) return null;
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

/**
 * Brings the window up from the background (creating it if it was closed into
 * the tray) and, if a project is given, opens it. The open-project event for a
 * freshly created window is buffered by the preload until the renderer mounts.
 */
function openFromBackground(projectId?: string): void {
  const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const win = existing ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!projectId) return;
  const send = (): void => {
    win.webContents.send("deploy:open-project", { projectId });
  };
  // A window created just now has no renderer frame yet — a send in this tick
  // goes nowhere, there is not even a preload to buffer it. Wait for the load;
  // from there the preload buffer covers the gap until the renderer subscribes
  if (!existing || win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

/** Системное уведомление о результате деплоя; клик открывает окно на проекте */
function notifyDeployResult(
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
  notification.on("click", () => openFromBackground(projectId));
  notification.show();
}

async function runDeploy(
  projectId: string,
  password: string | undefined,
  // Режим совместимости (npm --legacy-peer-deps); пользователь подтвердил кнопкой в GUI
  legacyPeerDeps?: boolean,
  // Перенос импортированного проекта под управление Plantar — прежний
  // takeover-деплой, но только как явное действие с подтверждением в GUI
  migrate = false,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  const server = getServer(project.serverId);
  // Импортированный проект живёт в бережном режиме: обновляется в своей
  // папке на сервере, без переноса под структуру Plantar
  if (project.external && !migrate) return runExternalInPlace(projectId, password);
  // Перенос под управление Plantar возможен только после привязки папки с кодом
  if (project.external && !project.path) throw new Error(t("externalNeedsFolder"));
  const dir = projectDir(project);
  let config = loadProjectConfig(dir);

  // Прогон регистрируется до первого await — второй одновременный деплой
  // одного проекта отсекается здесь же, не оставляя пустого файла лога
  // The migrate kind survives in the run state and history: after a failed
  // migrate the old pm2 process is deleted, so the "return to previous
  // version" recovery must not be offered for this run
  const kind = migrate ? ("migrate" as const) : ("deploy" as const);
  const run = startDeployRun(projectId, kind);
  const startedAt = new Date().toISOString();

  // git-проект: обновляем клон до свежего коммита ветки перед деплоем
  let deployedCommit: { hash: string; message: string } | undefined;
  let logWriter: DeployLogWriter | undefined;
  try {
    logWriter = new DeployLogWriter(config.name);
    const writer = logWriter;
    const log = (line: string) => {
      writer.write(line);
      run.log(line);
    };
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
    // Флаг не пишем в конфиг заранее: он закрепится ниже, только если деплой удался
    const deployConfig = legacyPeerDeps ? { ...config, legacyPeerDeps: true } : config;
    // При переносе под управление Plantar переменные из .env приложения
    // переезжают в хранилище Plantar — деплой подставит их как раньше
    if (migrate && project.external) {
      const appDir = project.external.appDir;
      await withServer(server, password, async (conn) => {
        if (!(await readProjectEnv(conn, config.name))) {
          const env = await readAppEnv(conn, appDir);
          if (env) await writeProjectEnv(conn, config.name, env);
        }
      });
    }
    const result = await withServer(server, password, (conn) =>
      deployProject(conn, dir, deployConfig, log, {
        letsEncryptEmail: settings.letsEncryptEmail || undefined,
        // Перенос под управление Plantar снимает прежний процесс и конфиг nginx
        takeover:
          migrate && project.external
            ? {
                pm2Name: project.external.pm2Name,
                nginxConfFile: project.external.nginxConfFile,
              }
            : undefined,
      }),
    );
    // Закрепляем в конфиге порт (выбирается на сервере при первом деплое)
    // и режим совместимости — подтверждённый выбор нужен и автодеплою из CI
    const configUpdates: Partial<ProjectConfig> = {};
    if (result.port && result.port !== config.port) configUpdates.port = result.port;
    if (legacyPeerDeps && !config.legacyPeerDeps) configUpdates.legacyPeerDeps = true;
    if (Object.keys(configUpdates).length > 0) {
      writeProjectConfig(dir, { ...config, ...configUpdates });
    }
    appendHistory({
      project: config.name,
      host: server.host,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "success",
      kind: migrate ? kind : undefined,
      url: result.url,
      commit: deployedCommit?.hash,
      logFile: logWriter.file,
    });
    // git-проект: запоминаем задеплоенный коммит для карточки проекта и вкладки «Коммиты»
    // После переноса под управление Plantar пометка «внешний» снимается —
    // дальше проект живёт как обычный (структура releases, мгновенный возврат)
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
      notifyDeployResult(projectId, config.name, true);
    }
    run.finish({ status: "success", url: result.url });
    return { url: result.url };
  } catch (err) {
    const message = (err as Error).message;
    const code = (err as { code?: string }).code;
    // Статус прогона обновляется первым: сбой записи на диск не должен
    // оставить проект навсегда заблокированным «идущим» деплоем
    run.finish({ status: "error", error: message, code });
    notifyDeployResult(projectId, config.name, false);
    if (logWriter) {
      logWriter.write(`\n${t("deployLogError")}: ${message}`);
      appendHistory({
        project: config.name,
        host: server.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        kind: migrate ? kind : undefined,
        error: message,
        code,
        commit: deployedCommit?.hash,
        logFile: logWriter.file,
      });
    }
    throw err;
  }
}

/**
 * Бережный деплой импортированного проекта: код обновляется в исходной папке
 * приложения на сервере (git), процесс перезапускается под прежним именем pm2.
 * nginx, порты и структура releases не меняются. С checkoutCommit —
 * возврат версии: разворачивается указанный коммит вместо вершины ветки.
 */
async function runExternalInPlace(
  projectId: string,
  password: string | undefined,
  checkoutCommit?: string,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  const server = getServer(project.serverId);
  const external = project.external;
  if (!external) throw new Error(t("projectNotFound"));
  const config = projectConfig(project);

  const run = startDeployRun(projectId, checkoutCommit ? "rollback" : "deploy");
  const startedAt = new Date().toISOString();
  const kind = checkoutCommit ? ("rollback" as const) : ("deploy" as const);

  let logWriter: DeployLogWriter | undefined;
  try {
    logWriter = new DeployLogWriter(config.name);
    const writer = logWriter;
    const log = (line: string) => {
      writer.write(line);
      run.log(line);
    };
    // Смоук-проверка только по известному домену: своего nginx-конфига
    // у бережного режима нет, адрес по IP приложению может не принадлежать
    const url =
      config.type !== "bot" && config.domain ? `https://${config.domain}/` : undefined;
    const result = await withServer(server, password, (conn) =>
      deployExternalInPlace(
        conn,
        {
          appDir: external.appDir,
          pm2Name: external.pm2Name,
          branch: external.branch,
          runtime: config.runtime,
          type: config.type,
          port: config.port,
          url,
        },
        log,
        checkoutCommit ? { checkout: checkoutCommit } : {},
      ),
    );
    appendHistory({
      project: config.name,
      host: server.host,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "success",
      kind,
      url,
      commit: result.commit?.hash,
      logFile: logWriter.file,
    });
    // Развёрнутый коммит — для строки версии на вкладке «Деплой» и кнопки
    // «вернуть предыдущую версию» после неудачного деплоя
    if (result.commit) {
      const commit = { hash: result.commit.hash, message: result.commit.subject };
      writeProjects(
        readProjects().map((p) =>
          p.id === project.id ? { ...p, deployedCommit: commit } : p,
        ),
      );
    }
    if (readSettings().notifyOnDeploySuccess) {
      notifyDeployResult(projectId, config.name, true);
    }
    run.finish({ status: "success", url });
    return { url };
  } catch (err) {
    const message = (err as Error).message;
    const code = (err as { code?: string }).code;
    // Статус прогона обновляется первым: сбой записи на диск не должен
    // оставить проект навсегда заблокированным «идущим» деплоем
    run.finish({ status: "error", error: message, code });
    notifyDeployResult(projectId, config.name, false);
    if (logWriter) {
      logWriter.write(`\n${t("deployLogError")}: ${message}`);
      appendHistory({
        project: config.name,
        host: server.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        kind,
        error: message,
        code,
        logFile: logWriter.file,
      });
    }
    throw err;
  }
}

/** Возврат предыдущей версии; лог идёт в тот же канал, что и лог деплоя */
async function runRollback(
  projectId: string,
  password: string | undefined,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  // У внешних проектов нет структуры releases — их возврат версии идёт
  // по git-истории через deploy:rollbackExternal
  if (project.external) throw new Error(t("rollbackUnavailableExternal"));
  const server = getServer(project.serverId);
  const config = projectConfig(project);

  const run = startDeployRun(projectId, "rollback");
  const startedAt = new Date().toISOString();

  let logWriter: DeployLogWriter | undefined;
  try {
    logWriter = new DeployLogWriter(config.name);
    const writer = logWriter;
    const log = (line: string) => {
      writer.write(line);
      run.log(line);
    };
    const result = await withServer(server, password, (conn) =>
      rollbackProject(conn, config, log),
    );
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
    run.finish({ status: "success", url: result.url });
    return { url: result.url };
  } catch (err) {
    const message = (err as Error).message;
    run.finish({ status: "error", error: message });
    if (logWriter) {
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
    }
    throw err;
  }
}

/**
 * Последний прогон проекта с диска — когда прогона нет в памяти
 * (приложение перезапустили). Свежайший deploy-*.log сверяется с историей:
 * есть запись — прогон завершён, файл новее последней записи — деплой
 * был прерван.
 */
function restoredDeployState(project: ProjectRecord): DeployRunState | null {
  const server = getServer(project.serverId);
  let name = project.name;
  try {
    name = projectConfig(project).name;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
  }
  const history = readHistory().filter(
    (r) => r.project === name && r.host === server.host,
  );
  const last = resolveLastRun(listDeployLogs(name), history);
  if (!last) return null;
  let text = "";
  try {
    text = readLogTail(last.logFile);
  } catch {
    /* файл лога удалён — показываем результат из истории без лога */
  }
  const record = last.record;
  const startedAt = record?.startedAt ?? deployLogTimestamp(last.logFile) ?? "";
  return {
    kind: record?.kind ?? "deploy",
    status: record ? record.status : "interrupted",
    lines: text ? text.replace(/\n$/, "").split("\n") : [],
    lastSeq: 0,
    startedAt,
    lastLineAt: record?.finishedAt ?? startedAt,
    url: record?.url,
    error: record?.error,
    errorCode: record?.code,
  };
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

/**
 * Живое окно на момент вызова. IPC-обработчики регистрируются один раз,
 * а окно на macOS может быть закрыто и создано заново из дока — захваченная
 * в замыкание ссылка после этого указывает на уничтоженное окно.
 */
function activeWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ??
    null
  );
}

// Живые лог-стримы: id → остановка. Активный стрим держит соединение в пуле занятым
const logStreams = new Map<string, () => void>();

function stopAllLogStreams(): void {
  for (const stop of logStreams.values()) stop();
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

  // При перезагрузке renderer или закрытии окна подписчики пропадают —
  // останавливаем осиротевшие стримы, чтобы не держать SSH-соединения занятыми.
  // Вешаем при создании: окно на macOS может пересоздаваться
  win.webContents.on("did-navigate", stopAllLogStreams);
  win.on("closed", stopAllLogStreams);

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
  createWindow();

  ipcMain.handle("settings:get", () => toResult(async () => readSettings()));
  ipcMain.handle("settings:set", (_e, settings: AppSettings) =>
    toResult(async () => {
      writeSettings(settings);
      setLanguage(settings.language);
      refreshTrayMenu();
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
  // Готовые ключи пользователя из ~/.ssh — для способа входа «ключ уже настроен»
  ipcMain.handle("ssh:detectKeys", () => toResult(async () => detectUserSshKeys()));
  // Серверы из ~/.ssh/config — подсказки для предзаполнения формы
  ipcMain.handle("ssh:configHosts", () => toResult(async () => detectSshConfigHosts()));
  ipcMain.handle("ssh:pickKey", () =>
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
  ipcMain.handle("servers:remove", (_e, id: string) =>
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
  ipcMain.handle("servers:reorder", (_e, ids: string[]) =>
    toResult(async () => {
      const servers = readServers();
      const byId = new Map(servers.map((s) => [s.id, s]));
      const ordered = ids.flatMap((id) => byId.get(id) ?? []);
      const rest = servers.filter((s) => !ids.includes(s.id));
      writeServers([...ordered, ...rest]);
    }),
  );

  ipcMain.handle("projects:list", () => toResult(async () => readProjects()));
  // Порядок проектов одного сервера в сайдбаре; позиции проектов других
  // серверов в общем списке не меняются
  ipcMain.handle("projects:reorder", (_e, args: { serverId: string; ids: string[] }) =>
    toResult(async () => {
      const projects = readProjects();
      const own = projects.filter((p) => p.serverId === args.serverId);
      const byId = new Map(own.map((p) => [p.id, p]));
      const ordered = [
        ...args.ids.flatMap((id) => byId.get(id) ?? []),
        ...own.filter((p) => !args.ids.includes(p.id)),
      ];
      let next = 0;
      writeProjects(projects.map((p) => (p.serverId === args.serverId ? ordered[next++] : p)));
    }),
  );
  ipcMain.handle("projects:pick", () => toResult(() => pickProjectFolder()));
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
      const win = activeWindow();
      if (!win) return null;
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
      const statusCache = readStatusTabCache();
      if (id in statusCache) {
        delete statusCache[id];
        writeStatusTabCache(statusCache);
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
    toResult(() => pickSubdir(root)),
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

  // Переменные проекта хранятся на сервере (вне папки версии) и применяются
  // при деплое; у внешних проектов читаются и сохраняются прямо в .env
  // папки приложения — хранилище Plantar на сервере не создаётся
  ipcMain.handle("env:read", (_e, args: { projectId: string; password?: string }) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      if (project.external) {
        const appDir = project.external.appDir;
        return withServer(getServer(project.serverId), args.password, (conn) =>
          readExternalEnv(conn, appDir),
        );
      }
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
        if (project.external) {
          const appDir = project.external.appDir;
          await withServer(getServer(project.serverId), args.password, (conn) =>
            writeExternalEnv(conn, appDir, args.content),
          );
          return;
        }
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

  // Таб «Файлы»: просмотр папки проекта на сервере, строго на чтение
  ipcMain.handle(
    "files:list",
    (_e, args: { projectId: string; path: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        return withServer(getServer(project.serverId), args.password, (conn) =>
          listProjectDir(conn, projectRemoteRoot(project), args.path),
        );
      }),
  );
  ipcMain.handle(
    "files:read",
    (
      _e,
      args: { projectId: string; path?: string; related?: RelatedFileId; password?: string },
    ) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const absPath = args.related
          ? relatedFilePath(project, args.related)
          : resolveProjectPath(projectRemoteRoot(project), args.path ?? "");
        return withServer(getServer(project.serverId), args.password, (conn) =>
          readRemoteTextFile(conn, absPath),
        );
      }),
  );
  ipcMain.handle("files:related", (_e, args: { projectId: string; password?: string }) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      if (project.external) return [];
      let config: ProjectConfig;
      try {
        config = projectConfig(project);
      } catch {
        // plantar.json недоступен — nginx-файлы этого проекта неизвестны
        return [];
      }
      if (config.type === "bot") return [];
      return withServer(getServer(project.serverId), args.password, (conn) =>
        getRelatedFiles(conn, config.name),
      );
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
      // Логи не ограничены по размеру — читаем только хвост
      return readLogTail(resolved);
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
  // Статусы приложений сервера: pm2-процессы одним запросом плюс живая
  // HTTP-проверка сайтов с самого сервера; снимок кэшируется
  // для мгновенного показа при следующем открытии приложения
  ipcMain.handle("server:appStatuses", (_e, args: { serverId: string }) =>
    toResult(() => collectServerAppStatuses(getServer(args.serverId))),
  );
  // Кэш статусов прошлой проверки — показывается сразу, пока идёт живая
  ipcMain.handle("server:appStatusesCache", () =>
    toResult(async () => readAppStatusCache()),
  );

  ipcMain.handle(
    "monitoring:status",
    (_e, args: { serverId: string; password?: string }) =>
      toResult(async () =>
        withServer(getServer(args.serverId), args.password, (conn) =>
          getMonitoringStatus(conn),
        ),
      ),
  );
  ipcMain.handle(
    "monitoring:install",
    (_e, args: { serverId: string; tool: MonitoringTool; password?: string }) =>
      toResult(async () => {
        // Имя инструмента попадает в shell-команду установки — только известные
        if (args.tool !== "goaccess" && args.tool !== "netdata") {
          throw new Error(t("unknownMonitoringTool"));
        }
        await withServer(getServer(args.serverId), args.password, (conn) =>
          installMonitoringTool(conn, args.tool),
        );
      }),
  );
  // Включает сбор нагрузки приложений: Netdata + скрипт-сборщик с cron
  ipcMain.handle(
    "monitoring:enableAppMetrics",
    (_e, args: { serverId: string; password?: string }) =>
      toResult(async () => {
        await withServer(getServer(args.serverId), args.password, (conn) =>
          enableAppMetrics(conn),
        );
      }),
  );

  // Здоровье pm2-процесса приложения; null — процесса на сервере нет
  ipcMain.handle(
    "metrics:app",
    (_e, args: { projectId: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const pm2Name = project.external ? project.external.pm2Name : name;
        const health = await withServer(server, args.password, (conn) =>
          pm2ProcessHealth(conn),
        );
        return health.get(pm2Name) ?? null;
      }),
  );

  // Посещаемость приложения по access-логу nginx (нужен GoAccess на сервере)
  ipcMain.handle(
    "metrics:traffic",
    (_e, args: { projectId: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const logPath =
          project.external?.accessLogPath ?? `/var/log/nginx/${name}.access.log`;
        return withServer(server, args.password, (conn) =>
          getTrafficStats(conn, logPath),
        );
      }),
  );

  // Кэш вкладки «Статус»: мгновенный показ устаревшего снимка при открытии
  ipcMain.handle("metrics:statusTabCache", (_e, projectId: string) =>
    toResult(async () => readStatusTabCache()[projectId] ?? null),
  );
  // Каждая карточка вкладки пишет своё поле по мере загрузки — патч, не замена
  ipcMain.handle(
    "metrics:statusTabCacheSave",
    (_e, args: { projectId: string; patch: Partial<StatusTabCacheEntry> }) =>
      toResult(async () => {
        const cache = readStatusTabCache();
        cache[args.projectId] = {
          ...cache[args.projectId],
          ...args.patch,
          cachedAt: new Date().toISOString(),
        };
        writeStatusTabCache(cache);
      }),
  );

  // История нагрузки сервера из Netdata; окно — час или сутки
  ipcMain.handle(
    "metrics:server",
    (_e, args: { serverId: string; seconds: number; password?: string }) =>
      toResult(async () => {
        const seconds = args.seconds === 86400 ? 86400 : 3600;
        // Проекты сервера подписывают ряды разбивки по приложениям
        const apps = readProjects()
          .filter((p) => p.serverId === args.serverId)
          .map((p) => {
            let name = p.name;
            try {
              name = projectConfig(p).name;
            } catch {
              /* plantar.json недоступен — используем имя на момент добавления */
            }
            return { pm2Name: p.external ? p.external.pm2Name : name, name: p.name };
          });
        return withServer(getServer(args.serverId), args.password, async (conn) => {
          await ensureAppMetricsScript(conn);
          return getServerMetrics(conn, seconds, apps);
        });
      }),
  );

  // История нагрузки приложения из Netdata; окно — час или сутки
  ipcMain.handle(
    "metrics:appHistory",
    (_e, args: { projectId: string; seconds: number; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const pm2Name = project.external ? project.external.pm2Name : name;
        const seconds = args.seconds === 86400 ? 86400 : 3600;
        return withServer(server, args.password, (conn) =>
          getAppMetricsHistory(conn, pm2Name, seconds),
        );
      }),
  );

  // Активность логов приложения за сутки (нужен включённый сбор нагрузки)
  ipcMain.handle(
    "metrics:appLogActivity",
    (_e, args: { projectId: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const pm2Name = project.external ? project.external.pm2Name : name;
        return withServer(server, args.password, (conn) =>
          getAppLogActivity(conn, pm2Name),
        );
      }),
  );

  ipcMain.handle(
    "deploy:run",
    (_e, args: { projectId: string; password?: string; legacyPeerDeps?: boolean }) =>
      toResult(() => runDeploy(args.projectId, args.password, args.legacyPeerDeps)),
  );
  ipcMain.handle("deploy:rollback", (_e, args: { projectId: string; password?: string }) =>
    toResult(() => runRollback(args.projectId, args.password)),
  );
  // Git-версии внешнего проекта с сервера — для вкладки «Версии»
  // и индикатора «развёрнута не последняя версия»
  ipcMain.handle(
    "versions:external",
    (_e, args: { projectId: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const external = project.external;
        if (!external) throw new Error(t("projectNotFound"));
        return withServer(getServer(project.serverId), args.password, (conn) =>
          getExternalVersions(conn, external.appDir, external.branch),
        );
      }),
  );
  // Light local-only sync check for the Status tab indicator: no network
  // fetch, so a slow git remote cannot delay the status snapshot
  ipcMain.handle(
    "versions:externalState",
    (_e, args: { projectId: string; password?: string }) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const external = project.external;
        if (!external) throw new Error(t("projectNotFound"));
        return withServer(getServer(project.serverId), args.password, (conn) =>
          getExternalSyncState(conn, external.appDir),
        );
      }),
  );
  // Возврат версии внешнего проекта: повторный деплой выбранного коммита
  ipcMain.handle(
    "deploy:rollbackExternal",
    (_e, args: { projectId: string; commit: string; password?: string }) =>
      toResult(async () => {
        // Хеш попадает в shell-команду на сервере — только настоящие хеши
        if (!/^[0-9a-f]{7,40}$/i.test(args.commit)) {
          throw new Error(t("invalidCommit"));
        }
        return runExternalInPlace(args.projectId, args.password, args.commit);
      }),
  );
  // Явный перенос импортированного проекта под управление Plantar:
  // прежний takeover-деплой, запускается только после подтверждения в GUI
  ipcMain.handle(
    "projects:migrate",
    (_e, args: { projectId: string; password?: string; legacyPeerDeps?: boolean }) =>
      toResult(() => runDeploy(args.projectId, args.password, args.legacyPeerDeps, true)),
  );
  // Идущие сейчас прогоны — начальное состояние индикаторов деплоя в сайдбаре
  ipcMain.handle("deploy:active", () => toResult(async () => activeDeployRuns()));
  // Состояние прогона деплоя для вкладки: из памяти, после перезапуска — с диска
  ipcMain.handle("deploy:state", (_e, projectId: string) =>
    toResult(async () => {
      const project = getProject(projectId);
      return deployRunState(projectId) ?? restoredDeployState(project);
    }),
  );

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
          activeWindow()?.webContents.send(channel, payload);
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

  // Defense in depth: only web links leave the app — file:// or a custom
  // scheme could trigger an arbitrary protocol handler on the user's machine
  ipcMain.handle("open-external", (_e, url: string) => {
    let protocol: string;
    try {
      protocol = new URL(url).protocol;
    } catch {
      console.warn("open-external: blocked url", url);
      return;
    }
    if (protocol !== "http:" && protocol !== "https:") {
      console.warn("open-external: blocked url", url);
      return;
    }
    return shell.openExternal(url);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Last, and each in its own try/catch: a tray that some Linux desktops cannot
  // create, or a broken status cache, must not leave the app without the IPC
  // handlers registered above — the window would open and every action fail
  try {
    // The tray keeps the app alive with the window closed — the background
    // monitor works on every platform, and the app can be reopened or quit
    createAppTray(() => openFromBackground());
  } catch (err) {
    console.error("[tray] init failed:", err);
  }
  try {
    startAppMonitor({
      collectStatuses: collectServerAppStatuses,
      openFromBackground,
    });
  } catch (err) {
    console.error("[monitor] init failed:", err);
  }
});

// Closing the window no longer quits the app: the background monitor keeps
// working from the tray. On Windows/Linux this changes the familiar behavior,
// so the first close of a session is explained with a notification.
let trayNoticeShown = false;
app.on("window-all-closed", () => {
  if (process.platform === "darwin" || trayNoticeShown) return;
  trayNoticeShown = true;
  if (!Notification.isSupported()) return;
  new Notification({
    title: t("trayBackgroundTitle"),
    body: t("trayBackgroundBody"),
  }).show();
});

app.on("before-quit", () => {
  stopAppMonitor();
  destroyTray();
});
