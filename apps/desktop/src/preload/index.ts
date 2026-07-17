import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, args?: unknown) => ipcRenderer.invoke(channel, args);

const api = {
  listServers: () => invoke("servers:list"),
  addServer: (input: unknown) => invoke("servers:add", input),
  removeServer: (id: string) => invoke("servers:remove", id),
  reorderServers: (ids: string[]) => invoke("servers:reorder", ids),

  listProjects: () => invoke("projects:list"),
  reorderProjects: (serverId: string, ids: string[]) =>
    invoke("projects:reorder", { serverId, ids }),
  pickProject: () => invoke("projects:pick"),
  listRepoBranches: (repoUrl: string) => invoke("repo:branches", repoUrl),
  cloneRepo: (repoUrl: string, branch: string) =>
    invoke("projects:cloneRepo", { repoUrl, branch }),
  cancelClone: (clonePath: string) => invoke("projects:cancelClone", clonePath),
  addProject: (input: unknown) => invoke("projects:add", input),
  discoverApps: (serverId: string, password?: string) =>
    invoke("server:discover", { serverId, password }),
  importProject: (input: unknown) => invoke("projects:import", input),
  linkProjectFolder: (projectId: string) => invoke("projects:linkFolder", projectId),
  linkProjectRepo: (projectId: string) => invoke("projects:linkRepo", projectId),
  removeProject: (id: string) => invoke("projects:remove", id),
  removeProjectFromServer: (projectId: string, password?: string) =>
    invoke("projects:removeFromServer", { projectId, password }),
  readProjectConfig: (projectId: string) => invoke("projects:readConfig", projectId),
  writeProjectConfig: (projectId: string, config: unknown, subdir?: string) =>
    invoke("projects:writeConfig", { projectId, config, subdir }),
  setProjectBranch: (projectId: string, branch: string) =>
    invoke("projects:setBranch", { projectId, branch }),
  pickSubdir: (root: string) => invoke("projects:pickSubdir", root),
  getCommitsCache: (projectId: string) => invoke("git:commitsCache", projectId),
  getCommitsView: (projectId: string) => invoke("git:commitsView", projectId),

  getSettings: () => invoke("settings:get"),
  setSettings: (settings: unknown) => invoke("settings:set", settings),

  githubAccount: () => invoke("github:account"),
  githubStartLogin: () => invoke("github:startLogin"),
  githubPollLogin: (deviceCode: string, interval: number, expiresIn: number) =>
    invoke("github:pollLogin", { deviceCode, interval, expiresIn }),
  githubSignOut: () => invoke("github:signOut"),
  setupGithubActions: (projectId: string, password?: string) =>
    invoke("github:setupActions", { projectId, password }),

  listHistory: (projectId: string) => invoke("history:list", projectId),
  readDeployLog: (logFile: string) => invoke("history:readLog", logFile),

  readEnv: (projectId: string, password?: string) => invoke("env:read", { projectId, password }),
  writeEnv: (projectId: string, content: string, password?: string) =>
    invoke("env:write", { projectId, content, password }),
  listLocalEnvFiles: (projectId: string) => invoke("env:listLocal", projectId),
  readLocalEnvFile: (projectId: string, file: string) =>
    invoke("env:readLocal", { projectId, file }),

  getServerInfo: (serverId: string, password?: string) =>
    invoke("server:info", { serverId, password }),
  isServerConnected: (serverId: string) => invoke("server:isConnected", serverId),
  getAppStatuses: (serverId: string) => invoke("server:appStatuses", { serverId }),
  getAppStatusCache: () => invoke("server:appStatusesCache"),
  getMonitoringStatus: (serverId: string, password?: string) =>
    invoke("monitoring:status", { serverId, password }),
  installMonitoringTool: (serverId: string, tool: string, password?: string) =>
    invoke("monitoring:install", { serverId, tool, password }),
  enableAppMetrics: (serverId: string, password?: string) =>
    invoke("monitoring:enableAppMetrics", { serverId, password }),
  getAppHealth: (projectId: string, password?: string) =>
    invoke("metrics:app", { projectId, password }),
  getTrafficStats: (projectId: string, password?: string) =>
    invoke("metrics:traffic", { projectId, password }),
  getServerMetrics: (serverId: string, seconds: number, password?: string) =>
    invoke("metrics:server", { serverId, seconds, password }),
  getAppMetricsHistory: (projectId: string, seconds: number, password?: string) =>
    invoke("metrics:appHistory", { projectId, seconds, password }),
  getAppLogActivity: (projectId: string, password?: string) =>
    invoke("metrics:appLogActivity", { projectId, password }),
  deploy: (projectId: string, password?: string, legacyPeerDeps?: boolean) =>
    invoke("deploy:run", { projectId, password, legacyPeerDeps }),
  rollback: (projectId: string, password?: string) =>
    invoke("deploy:rollback", { projectId, password }),
  getDeployState: (projectId: string) => invoke("deploy:state", projectId),
  getActiveDeploys: () => invoke("deploy:active"),

  startLogStream: (projectId: string, source: string, password?: string) =>
    invoke("logs:streamStart", { projectId, source, password }),
  stopLogStream: (streamId: string) => invoke("logs:streamStop", streamId),

  openExternal: (url: string) => invoke("open-external", url),

  onDeployLog: (
    callback: (event: { projectId: string; seq: number; line: string }) => void,
  ) => {
    const handler = (
      _e: unknown,
      data: { projectId: string; seq: number; line: string },
    ) => callback(data);
    ipcRenderer.on("deploy:log", handler);
    return () => ipcRenderer.removeListener("deploy:log", handler);
  },

  onDeployStarted: (
    callback: (event: { projectId: string; kind: string }) => void,
  ) => {
    const handler = (_e: unknown, data: { projectId: string; kind: string }) =>
      callback(data);
    ipcRenderer.on("deploy:started", handler);
    return () => ipcRenderer.removeListener("deploy:started", handler);
  },

  onDeployFinished: (
    callback: (event: {
      projectId: string;
      kind: string;
      status: string;
      url?: string;
      error?: string;
      code?: string;
    }) => void,
  ) => {
    const handler = (
      _e: unknown,
      data: {
        projectId: string;
        kind: string;
        status: string;
        url?: string;
        error?: string;
        code?: string;
      },
    ) => callback(data);
    ipcRenderer.on("deploy:finished", handler);
    return () => ipcRenderer.removeListener("deploy:finished", handler);
  },

  onLogStreamData: (
    callback: (event: { streamId: string; channel: string; text: string }) => void,
  ) => {
    const handler = (
      _e: unknown,
      data: { streamId: string; channel: string; text: string },
    ) => callback(data);
    ipcRenderer.on("logs:stream-data", handler);
    return () => ipcRenderer.removeListener("logs:stream-data", handler);
  },

  onLogStreamEnd: (callback: (event: { streamId: string }) => void) => {
    const handler = (_e: unknown, data: { streamId: string }) => callback(data);
    ipcRenderer.on("logs:stream-end", handler);
    return () => ipcRenderer.removeListener("logs:stream-end", handler);
  },

  onOpenProject: (callback: (event: { projectId: string }) => void) => {
    const handler = (_e: unknown, data: { projectId: string }) => callback(data);
    ipcRenderer.on("deploy:open-project", handler);
    return () => ipcRenderer.removeListener("deploy:open-project", handler);
  },
};

contextBridge.exposeInMainWorld("plantar", api);
