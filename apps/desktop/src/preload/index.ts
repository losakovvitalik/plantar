import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, args?: unknown) => ipcRenderer.invoke(channel, args);

const api = {
  listServers: () => invoke("servers:list"),
  addServer: (input: unknown) => invoke("servers:add", input),
  removeServer: (id: string) => invoke("servers:remove", id),

  listProjects: () => invoke("projects:list"),
  pickProject: () => invoke("projects:pick"),
  addProject: (input: unknown) => invoke("projects:add", input),
  removeProject: (id: string) => invoke("projects:remove", id),
  removeProjectFromServer: (projectId: string, password?: string) =>
    invoke("projects:removeFromServer", { projectId, password }),
  readProjectConfig: (projectId: string) => invoke("projects:readConfig", projectId),
  writeProjectConfig: (projectId: string, config: unknown) =>
    invoke("projects:writeConfig", { projectId, config }),

  getSettings: () => invoke("settings:get"),
  setSettings: (settings: unknown) => invoke("settings:set", settings),

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
  deploy: (projectId: string, password?: string) => invoke("deploy:run", { projectId, password }),
  getLogs: (projectId: string, password?: string) => invoke("logs:get", { projectId, password }),

  openExternal: (url: string) => invoke("open-external", url),

  onDeployLog: (callback: (event: { projectId: string; line: string }) => void) => {
    const handler = (_e: unknown, data: { projectId: string; line: string }) => callback(data);
    ipcRenderer.on("deploy:log", handler);
    return () => ipcRenderer.removeListener("deploy:log", handler);
  },

  onOpenProject: (callback: (event: { projectId: string }) => void) => {
    const handler = (_e: unknown, data: { projectId: string }) => callback(data);
    ipcRenderer.on("deploy:open-project", handler);
    return () => ipcRenderer.removeListener("deploy:open-project", handler);
  },
};

contextBridge.exposeInMainWorld("plantar", api);
