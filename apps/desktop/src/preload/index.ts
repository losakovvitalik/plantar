import { contextBridge, ipcRenderer } from "electron";
import type { IpcEventMap, IpcInvokeMap, IpcResult, PlantarApi } from "../shared/ipc";

// The one place the untyped ipcRenderer.invoke meets the shared registry:
// each channel's args and result come from IpcInvokeMap, the same map the
// `handle` wrapper in main is checked against
const invoke = <C extends keyof IpcInvokeMap>(
  channel: C,
  ...args: IpcInvokeMap[C]["args"] extends void ? [] : [IpcInvokeMap[C]["args"]]
): Promise<IpcResult<IpcInvokeMap[C]["result"]>> => ipcRenderer.invoke(channel, ...args);

// Typed push-event subscription; the returned function unsubscribes
const subscribe = <C extends keyof IpcEventMap>(
  channel: C,
  callback: (event: IpcEventMap[C]) => void,
): (() => void) => {
  const handler = (_e: unknown, data: IpcEventMap[C]) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: PlantarApi = {
  listServers: () => invoke("servers:list"),
  addServer: (input) => invoke("servers:add", input),
  removeServer: (id) => invoke("servers:remove", id),
  reorderServers: (ids) => invoke("servers:reorder", ids),
  detectSshKeys: () => invoke("ssh:detectKeys"),
  pickSshKeyFile: () => invoke("ssh:pickKey"),
  listSshConfigHosts: () => invoke("ssh:configHosts"),

  listProjects: () => invoke("projects:list"),
  reorderProjects: (serverId, ids) => invoke("projects:reorder", { serverId, ids }),
  pickProject: () => invoke("projects:pick"),
  listRepoBranches: (repoUrl) => invoke("repo:branches", repoUrl),
  cloneRepo: (repoUrl, branch) => invoke("projects:cloneRepo", { repoUrl, branch }),
  cancelClone: (clonePath) => invoke("projects:cancelClone", clonePath),
  addProject: (input) => invoke("projects:add", input),
  discoverApps: (serverId, password) => invoke("server:discover", { serverId, password }),
  importProject: (input) => invoke("projects:import", input),
  linkProjectFolder: (projectId) => invoke("projects:linkFolder", projectId),
  linkProjectRepo: (projectId) => invoke("projects:linkRepo", projectId),
  removeProject: (id) => invoke("projects:remove", id),
  removeProjectFromServer: (projectId, password) =>
    invoke("projects:removeFromServer", { projectId, password }),
  readProjectConfig: (projectId) => invoke("projects:readConfig", projectId),
  writeProjectConfig: (projectId, config, subdir) =>
    invoke("projects:writeConfig", { projectId, config, subdir }),
  setProjectBranch: (projectId, branch) =>
    invoke("projects:setBranch", { projectId, branch }),
  pickSubdir: (root) => invoke("projects:pickSubdir", root),
  getCommitsCache: (projectId) => invoke("git:commitsCache", projectId),
  getCommitsView: (projectId) => invoke("git:commitsView", projectId),

  getSettings: () => invoke("settings:get"),
  setSettings: (settings) => invoke("settings:set", settings),
  resolveMcpPort: () => invoke("mcp:resolvePort"),

  githubAccount: () => invoke("github:account"),
  githubStartLogin: () => invoke("github:startLogin"),
  githubPollLogin: (deviceCode, interval, expiresIn) =>
    invoke("github:pollLogin", { deviceCode, interval, expiresIn }),
  githubSignOut: () => invoke("github:signOut"),
  setupGithubActions: (projectId, password) =>
    invoke("github:setupActions", { projectId, password }),

  listHistory: (projectId) => invoke("history:list", projectId),
  readDeployLog: (logFile) => invoke("history:readLog", logFile),

  listProjectFiles: (projectId, path, password) =>
    invoke("files:list", { projectId, path, password }),
  readProjectFile: (projectId, path, password) =>
    invoke("files:read", { projectId, path, password }),
  readRelatedFile: (projectId, related, password) =>
    invoke("files:read", { projectId, related, password }),
  listRelatedFiles: (projectId, password) =>
    invoke("files:related", { projectId, password }),

  readEnv: (projectId, password) => invoke("env:read", { projectId, password }),
  writeEnv: (projectId, content, password) =>
    invoke("env:write", { projectId, content, password }),
  listLocalEnvFiles: (projectId) => invoke("env:listLocal", projectId),
  readLocalEnvFile: (projectId, file) => invoke("env:readLocal", { projectId, file }),

  getServerInfo: (serverId, password) => invoke("server:info", { serverId, password }),
  isServerConnected: (serverId) => invoke("server:isConnected", serverId),
  getAppStatuses: (serverId) => invoke("server:appStatuses", { serverId }),
  getAppStatusCache: () => invoke("server:appStatusesCache"),
  getMonitoringStatus: (serverId, password) =>
    invoke("monitoring:status", { serverId, password }),
  installMonitoringTool: (serverId, tool, password) =>
    invoke("monitoring:install", { serverId, tool, password }),
  enableAppMetrics: (serverId, password) =>
    invoke("monitoring:enableAppMetrics", { serverId, password }),
  getAppHealth: (projectId, password) => invoke("metrics:app", { projectId, password }),
  getTrafficStats: (projectId, password) =>
    invoke("metrics:traffic", { projectId, password }),
  getStatusTabCache: (projectId) => invoke("metrics:statusTabCache", projectId),
  saveStatusTabCache: (projectId, patch) =>
    invoke("metrics:statusTabCacheSave", { projectId, patch }),
  getServerMetrics: (serverId, seconds, password) =>
    invoke("metrics:server", { serverId, seconds, password }),
  getAppMetricsHistory: (projectId, seconds, password) =>
    invoke("metrics:appHistory", { projectId, seconds, password }),
  getAppLogActivity: (projectId, password) =>
    invoke("metrics:appLogActivity", { projectId, password }),
  deploy: (projectId, password, legacyPeerDeps) =>
    invoke("deploy:run", { projectId, password, legacyPeerDeps }),
  rollback: (projectId, password) => invoke("deploy:rollback", { projectId, password }),
  externalVersions: (projectId, password) =>
    invoke("versions:external", { projectId, password }),
  externalSyncState: (projectId, password) =>
    invoke("versions:externalState", { projectId, password }),
  rollbackExternalTo: (projectId, commit, password) =>
    invoke("deploy:rollbackExternal", { projectId, commit, password }),
  migrateProject: (projectId, password) =>
    invoke("projects:migrate", { projectId, password }),
  setupExternalHttps: (projectId, password) =>
    invoke("external:setupHttps", { projectId, password }),
  enableExternalAccessLog: (projectId, password) =>
    invoke("external:enableAccessLog", { projectId, password }),
  getDeployState: (projectId) => invoke("deploy:state", projectId),
  getActiveDeploys: () => invoke("deploy:active"),

  startLogStream: (projectId, source, password) =>
    invoke("logs:streamStart", { projectId, source, password }),
  stopLogStream: (streamId) => invoke("logs:streamStop", streamId),

  openExternal: (url) => invoke("open-external", url),

  onDeployLog: (callback) => subscribe("deploy:log", callback),
  onDeployStarted: (callback) => subscribe("deploy:started", callback),
  onDeployFinished: (callback) => subscribe("deploy:finished", callback),
  onLogStreamData: (callback) => subscribe("logs:stream-data", callback),
  onLogStreamEnd: (callback) => subscribe("logs:stream-end", callback),
  onServerIdentityChanged: (callback) => subscribe("server:identity-changed", callback),

  // Unlike the other subscriptions, only one subscriber at a time: a second
  // onOpenProject displaces the first callback. Enough for the single listener
  // in the app shell; more would need a Set of callbacks
  onOpenProject: (callback) => {
    openProjectCallback = callback;
    if (pendingOpenProject) {
      callback(pendingOpenProject);
      pendingOpenProject = null;
    }
    return () => {
      if (openProjectCallback === callback) openProjectCallback = null;
    };
  },
};

// A notification click can create the window anew; the event then arrives
// before the renderer mounts and subscribes — buffer it until it does
let openProjectCallback: ((event: { projectId: string }) => void) | null = null;
let pendingOpenProject: { projectId: string } | null = null;
subscribe("deploy:open-project", (data) => {
  if (openProjectCallback) openProjectCallback(data);
  else pendingOpenProject = data;
});

contextBridge.exposeInMainWorld("plantar", api);
