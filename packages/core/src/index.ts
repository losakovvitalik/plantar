// Public surface of @plantar/core; the implementation lives in per-domain
// modules (server-info, env-store, logs, releases, nginx, deploy, rollback,
// remove-project and the pre-existing ones re-exported below).
export {
  AppNotRespondingError,
  ProcessUnstableError,
} from "./process-checks";
export type { SiteCheckStatus } from "./process-checks";
export {
  deployExternalInPlace,
  getExternalSyncState,
  getExternalVersions,
  parseServerCommits,
  readExternalEnv,
  writeExternalEnv,
} from "./external";
export type {
  ExternalDeployResult,
  ExternalSyncState,
  ExternalTarget,
  ExternalVersions,
  ServerCommit,
} from "./external";

export {
  ENV_FILE_RE,
  discoverApps,
  listAppEnvFiles,
  normalizeGitUrl,
  parseListeningPorts,
  parseNginxSites,
  parsePm2Jlist,
  readAppEnv,
} from "./discover";
export type { DiscoveredApp, NginxSite, Pm2App } from "./discover";
export {
  checkSitesRespond,
  parsePm2Health,
  pm2ProcessHealth,
  pm2ProcessStatuses,
} from "./status";
export type { Pm2ProcessHealth } from "./status";
export {
  appMetricsGroupName,
  downsampleAverage,
  enableAppMetrics,
  ensureAppMetricsScript,
  findAppMetricsChart,
  getAppLogActivity,
  getAppMetricsHistory,
  getMonitoringStatus,
  getServerMetrics,
  getTrafficStats,
  installMonitoringTool,
  markSharedLog,
  parseGoaccessReport,
  SHARED_LOG_TRAFFIC,
} from "./monitoring";
export type {
  AppLogPoint,
  AppMetricsHistory,
  MonitoringStatus,
  MonitoringTool,
  ServerAppUsage,
  ServerMetricPoint,
  ServerMetrics,
  TrafficStats,
} from "./monitoring";
export {
  getRelatedFiles,
  listProjectDir,
  nginxRelatedPaths,
  readRemoteTextFile,
  resolveProjectPath,
} from "./files";
export { addAccessLogDirective, enableExternalAccessLog } from "./nginx-external";
export type { AccessLogInsertion, AccessLogTarget } from "./nginx-external";
export type {
  RelatedFile,
  RelatedFileId,
  RemoteFileContent,
  RemoteFileEntry,
  RemoteFileKind,
} from "./files";

export {
  type ServerInfo,
  type SetupStepResult,
  getServerInfo,
  parseServerInfoOutput,
  serverInfoCommand,
  setupServer,
} from "./server-info";
export { readProjectEnv, writeProjectEnv } from "./env-store";
export {
  type LogStreamSource,
  type SiteLogs,
  getSiteLogs,
  logStreamCommand,
  pm2LogExpr,
} from "./logs";
export { type ReleasesInfo, appBaseDir, listReleases } from "./releases";
export { certbotAccountArgs, setupExternalHttps } from "./nginx";
export { removeDeployedProject } from "./remove-project";
export {
  type DeployOptions,
  type DeployResult,
  NpmPeerConflictError,
  deployProject,
  pickFreePort,
} from "./deploy";
export {
  type RollbackResult,
  pickRollbackTarget,
  rollbackProject,
} from "./rollback";
