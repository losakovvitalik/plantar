import { contextBridge, ipcRenderer } from "electron";

const api = {
  getServerInfo: (params: unknown) => ipcRenderer.invoke("server:info", params),
};

contextBridge.exposeInMainWorld("plantar", api);
