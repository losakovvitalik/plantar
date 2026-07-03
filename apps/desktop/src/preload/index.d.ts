import type { ServerInfo } from "@plantar/core";

export interface ConnectionParams {
  host: string;
  port: string;
  user: string;
  password?: string;
  keyPath?: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    plantar: {
      getServerInfo: (params: ConnectionParams) => Promise<IpcResult<ServerInfo>>;
    };
  }
}
