import type { PlantarApi } from "../shared/ipc";

/**
 * The renderer's single import point for everything that crosses the context
 * bridge. The types themselves are declared once in ../shared/ipc.ts (or in
 * the @plantar packages) — this file only re-exports them and binds
 * window.plantar to the PlantarApi shape the preload implementation is
 * typechecked against.
 */

export type { DetectedProject, ProjectConfig, ProjectConfigInput } from "@plantar/config";
export type {
  AppLogPoint,
  AppMetricsHistory,
  DiscoveredApp,
  ExternalSyncState,
  ExternalVersions,
  LogStreamSource,
  MonitoringStatus,
  MonitoringTool,
  Pm2ProcessHealth,
  RelatedFile,
  RelatedFileId,
  RemoteFileContent,
  RemoteFileEntry,
  ServerAppUsage,
  ServerInfo,
  ServerMetricPoint,
  ServerMetrics,
  SiteCheckStatus,
  TrafficStats,
} from "@plantar/core";
export type {
  AppSettings,
  AppStatus,
  AppStatusEntry,
  DeployRecord,
  ProjectRecord,
  ServerRecord,
} from "@plantar/storage";
export type {
  AddProjectInput,
  AddServerInput,
  AppStatusSnapshot,
  AppStatusTabCache,
  CommitsView,
  DeployFinishedEvent,
  DeployKind,
  DeployRunState,
  DeployStartedEvent,
  DetectedSshKey,
  DeviceLogin,
  GitCommit,
  GithubAccount,
  ImportProjectInput,
  IpcResult,
  PickedProject,
  PlantarApi,
  RemoteBranches,
  SetupActionsResult,
  SshConfigHost,
  SubdirPick,
} from "../shared/ipc";

declare global {
  interface Window {
    plantar: PlantarApi;
  }
}
