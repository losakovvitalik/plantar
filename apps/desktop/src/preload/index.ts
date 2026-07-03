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
  readProjectConfig: (projectId: string) => invoke("projects:readConfig", projectId),
  writeProjectConfig: (projectId: string, config: unknown) =>
    invoke("projects:writeConfig", { projectId, config }),

  listEnvFiles: (projectId: string) => invoke("env:list", projectId),
  readEnvFile: (projectId: string, file: string) => invoke("env:read", { projectId, file }),
  writeEnvFile: (projectId: string, file: string, content: string) =>
    invoke("env:write", { projectId, file, content }),

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
};

contextBridge.exposeInMainWorld("plantar", api);
