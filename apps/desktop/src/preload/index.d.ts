import type { DetectedProject, ProjectConfig, ProjectConfigInput } from "@plantar/config";
import type { ServerInfo, SiteLogs } from "@plantar/core";
import type { AppSettings, DeployRecord, ProjectRecord, ServerRecord } from "@plantar/storage";

export type {
  DetectedProject,
  ProjectConfig,
  ProjectConfigInput,
  ServerInfo,
  SiteLogs,
  ProjectRecord,
  ServerRecord,
};

export interface PickedProject {
  path: string;
  config: ProjectConfig | null;
  detected: DetectedProject;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AddServerInput {
  name: string;
  host: string;
  port: number;
  user: string;
  auth: "key" | "password";
  password: string;
}

declare global {
  interface Window {
    plantar: {
      listServers: () => Promise<IpcResult<ServerRecord[]>>;
      addServer: (input: AddServerInput) => Promise<IpcResult<ServerRecord>>;
      removeServer: (id: string) => Promise<IpcResult<void>>;

      listProjects: () => Promise<IpcResult<ProjectRecord[]>>;
      pickProject: () => Promise<IpcResult<PickedProject | null>>;
      addProject: (input: {
        serverId: string;
        path: string;
        config?: ProjectConfigInput;
      }) => Promise<IpcResult<ProjectRecord>>;
      removeProject: (id: string) => Promise<IpcResult<void>>;
      removeProjectFromServer: (
        projectId: string,
        password?: string,
      ) => Promise<IpcResult<void>>;
      readProjectConfig: (projectId: string) => Promise<IpcResult<ProjectConfig>>;
      writeProjectConfig: (
        projectId: string,
        config: ProjectConfigInput,
      ) => Promise<IpcResult<ProjectConfig>>;

      getSettings: () => Promise<IpcResult<AppSettings>>;
      setSettings: (settings: AppSettings) => Promise<IpcResult<void>>;

      listHistory: (projectId: string) => Promise<IpcResult<DeployRecord[]>>;
      readDeployLog: (logFile: string) => Promise<IpcResult<string>>;

      readEnv: (projectId: string, password?: string) => Promise<IpcResult<string>>;
      writeEnv: (
        projectId: string,
        content: string,
        password?: string,
      ) => Promise<IpcResult<void>>;
      listLocalEnvFiles: (projectId: string) => Promise<IpcResult<string[]>>;
      readLocalEnvFile: (projectId: string, file: string) => Promise<IpcResult<string>>;

      getServerInfo: (serverId: string, password?: string) => Promise<IpcResult<ServerInfo>>;
      deploy: (projectId: string, password?: string) => Promise<IpcResult<{ url?: string }>>;
      getLogs: (projectId: string, password?: string) => Promise<IpcResult<SiteLogs>>;

      openExternal: (url: string) => Promise<IpcResult<void>>;

      onDeployLog: (
        callback: (event: { projectId: string; line: string }) => void,
      ) => () => void;

      onOpenProject: (callback: (event: { projectId: string }) => void) => () => void;
    };
  }
}
