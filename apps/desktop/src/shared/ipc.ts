import type { DetectedProject, ProjectConfig, ProjectConfigInput } from "@plantar/config";
import type {
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
  ServerInfo,
  ServerMetrics,
  SiteCheckStatus,
  TrafficStats,
} from "@plantar/core";
import type {
  AppSettings,
  AppStatusEntry,
  DeployRecord,
  ProjectRecord,
  ServerRecord,
} from "@plantar/storage";

/**
 * The IPC contract between main, preload and the renderer: every domain type
 * that crosses the context bridge, plus the channel registries (IpcInvokeMap,
 * IpcEventMap) that pin each `ipcMain.handle` in main and each `invoke` in
 * preload to one args/result pair. Both sides typecheck against this file,
 * so a divergence fails `tsc` instead of surfacing at runtime.
 *
 * Type-only: this file is included by both tsconfig.node.json (main, preload)
 * and tsconfig.web.json (renderer, via the preload .d.ts re-exports) and must
 * not contain runtime code.
 */

/** code — машинный код ошибки (например npm-peer-conflict) для действий в GUI */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export interface AddServerInput {
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

/** Приватный ключ, найденный в стандартной папке ключей (~/.ssh) */
export interface DetectedSshKey {
  path: string;
  /** Имя файла — для показа в списке выбора */
  label: string;
}

/** Запись из ~/.ssh/config, пригодная для предзаполнения формы добавления сервера */
export interface SshConfigHost {
  /** Алиас из строки Host — идёт в название сервера */
  name: string;
  host: string;
  port?: number;
  user?: string;
  /** Путь к ключу (IdentityFile), если файл существует */
  identityFile?: string;
}

export interface AddProjectInput {
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

/** Импорт найденного на сервере приложения как внешнего проекта */
export interface ImportProjectInput {
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

export interface PickedProject {
  path: string;
  config: ProjectConfig | null;
  detected: DetectedProject;
}

export interface SubdirPick {
  /** repo-относительный путь; "" — корень репозитория */
  subdir: string;
  config: ProjectConfig | null;
  detected: DetectedProject;
}

export interface RemoteBranches {
  branches: string[];
  /** Дефолтная ветка репозитория (HEAD) */
  default: string;
}

export interface GithubAccount {
  login: string;
  /**
   * Токену разрешено менять файлы автодеплоя (.github/workflows) — scope workflow.
   * У входов, сделанных до появления «деплоя при коммите», такого права нет:
   * права токена не меняются задним числом, нужен повторный вход.
   */
  canWriteWorkflows: boolean;
}

export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  /** Интервал опроса в секундах */
  interval: number;
  /** Время жизни кода в секундах */
  expiresIn: number;
}

/** Результат автонастройки деплоя при коммите (GitHub Actions) */
export interface SetupActionsResult {
  branch: string;
  actionsUrl: string;
}

export interface GitCommit {
  hash: string;
  subject: string;
  /** ISO-дата коммита */
  date: string;
  author: string;
}

/** Снимок вкладки «Коммиты»: коммиты ветки + статусы деплоев для бейджей */
export interface CommitsView {
  commits: GitCommit[];
  history: DeployRecord[];
}

/** Снимок вкладки «Статус»: здоровье процесса + посещаемость (что применимо к типу) */
export interface AppStatusSnapshot {
  /** undefined — тип без процесса (static); null — процесс на сервере не найден */
  health?: Pm2ProcessHealth | null;
  /** undefined — тип без сайта (bot) или не установлен GoAccess */
  traffic?: TrafficStats;
  goaccessMissing: boolean;
  /** Включён ли на сервере сбор нагрузки приложений; undefined — тип без процесса */
  appMetrics?: boolean;
  /** Внешний git-проект: папка на сервере закреплена на старой версии
   *  (отвязанный HEAD после возврата версии) */
  detachedHead?: boolean;
}

/** Кэш вкладки «Статус»: устаревшие данные для мгновенного показа.
 *  Поля пишутся независимо — каждая карточка сохраняет своё по мере загрузки */
export interface AppStatusTabCache {
  snapshot?: AppStatusSnapshot;
  /** История нагрузки за час — окно, которое видно при открытии вкладки */
  metricsHistory?: AppMetricsHistory;
  /** Активность логов за сутки по часам */
  logActivity?: AppLogPoint[];
  cachedAt: string;
}

/** migrate — moving an external project under Plantar management: after it
 *  fails the old pm2 process is already gone, so the GUI must not offer
 *  the "return to previous version" recovery */
export type DeployKind = "deploy" | "rollback" | "migrate";

/** Снимок прогона для вкладки «Деплой»; interrupted — только у прогонов,
 *  восстановленных с диска (приложение закрыли посреди деплоя) */
export interface DeployRunState {
  kind: DeployKind;
  status: "running" | "success" | "error" | "interrupted";
  /** Хвост лога; полный лог — в файле */
  lines: string[];
  /** Порядковый номер последней строки: события с номером не больше него
   *  renderer отбрасывает — закрывает гонку между снимком и подпиской */
  lastSeq: number;
  startedAt: string;
  /** Время последней строки — счётчик текущего шага продолжается от неё */
  lastLineAt: string;
  url?: string;
  /** How the address answered the availability check after the run;
   *  undefined when there was no address to check */
  urlCheck?: SiteCheckStatus;
  error?: string;
  /** Машинный код ошибки (например npm-peer-conflict) для действий в GUI */
  errorCode?: string;
}

/** Старт прогона деплоя или возврата версии (событие deploy:started) */
export interface DeployStartedEvent {
  projectId: string;
  kind: DeployKind;
}

/** Завершение прогона деплоя (событие deploy:finished) */
export interface DeployFinishedEvent {
  projectId: string;
  kind: DeployKind;
  status: "success" | "error";
  url?: string;
  /** How the address answered the availability check; undefined when there
   *  was no address to check */
  urlCheck?: SiteCheckStatus;
  error?: string;
  code?: string;
}

/**
 * Invoke channels: what preload sends (`args`) and what the main handler must
 * return (`result`, always wrapped in IpcResult). Adding a channel here is the
 * only way to expose it — both the `handle` wrapper in main and the `invoke`
 * wrapper in preload accept nothing outside this map.
 */
export interface IpcInvokeMap {
  "servers:list": { args: void; result: ServerRecord[] };
  "servers:add": { args: AddServerInput; result: ServerRecord };
  "servers:remove": { args: string; result: void };
  "servers:reorder": { args: string[]; result: void };
  "ssh:detectKeys": { args: void; result: DetectedSshKey[] };
  "ssh:pickKey": { args: void; result: string | null };
  "ssh:configHosts": { args: void; result: SshConfigHost[] };

  "projects:list": { args: void; result: ProjectRecord[] };
  "projects:reorder": { args: { serverId: string; ids: string[] }; result: void };
  "projects:pick": { args: void; result: PickedProject | null };
  "repo:branches": { args: string; result: RemoteBranches };
  "projects:cloneRepo": {
    args: { repoUrl: string; branch: string };
    result: PickedProject;
  };
  "projects:cancelClone": { args: string; result: void };
  "projects:add": { args: AddProjectInput; result: ProjectRecord };
  "server:discover": {
    args: { serverId: string; password?: string };
    result: DiscoveredApp[];
  };
  "projects:import": { args: ImportProjectInput; result: ProjectRecord };
  "projects:linkFolder": {
    args: string;
    result: { project: ProjectRecord; config: ProjectConfig } | null;
  };
  "projects:linkRepo": {
    args: string;
    result: { project: ProjectRecord; config: ProjectConfig };
  };
  "projects:remove": { args: string; result: void };
  "projects:removeFromServer": {
    args: { projectId: string; password?: string };
    result: void;
  };
  "projects:readConfig": { args: string; result: ProjectConfig };
  "projects:writeConfig": {
    args: { projectId: string; config: ProjectConfigInput; subdir?: string };
    result: ProjectConfig;
  };
  "projects:setBranch": { args: { projectId: string; branch: string }; result: void };
  "projects:pickSubdir": { args: string; result: SubdirPick | null };
  "git:commitsCache": { args: string; result: CommitsView | null };
  "git:commitsView": { args: string; result: CommitsView };

  "settings:get": { args: void; result: AppSettings };
  "settings:set": { args: AppSettings; result: void };
  "mcp:resolvePort": { args: void; result: number | null };

  "github:account": { args: void; result: GithubAccount | null };
  "github:startLogin": { args: void; result: DeviceLogin };
  "github:pollLogin": {
    args: { deviceCode: string; interval: number; expiresIn: number };
    result: GithubAccount;
  };
  "github:signOut": { args: void; result: void };
  "github:setupActions": {
    args: { projectId: string; password?: string };
    result: SetupActionsResult;
  };

  "history:list": { args: string; result: DeployRecord[] };
  "history:readLog": { args: string; result: string };

  "files:list": {
    args: { projectId: string; path: string; password?: string };
    result: RemoteFileEntry[];
  };
  "files:read": {
    args: { projectId: string; path?: string; related?: RelatedFileId; password?: string };
    result: RemoteFileContent;
  };
  "files:related": {
    args: { projectId: string; password?: string };
    result: RelatedFile[];
  };

  "env:read": { args: { projectId: string; password?: string }; result: string };
  "env:write": {
    args: { projectId: string; content: string; password?: string };
    result: void;
  };
  "env:listLocal": { args: string; result: string[] };
  "env:readLocal": { args: { projectId: string; file: string }; result: string };

  "server:info": { args: { serverId: string; password?: string }; result: ServerInfo };
  "server:isConnected": { args: string; result: boolean };
  "server:appStatuses": { args: { serverId: string }; result: AppStatusEntry };
  "server:appStatusesCache": { args: void; result: Record<string, AppStatusEntry> };
  "monitoring:status": {
    args: { serverId: string; password?: string };
    result: MonitoringStatus;
  };
  "monitoring:install": {
    args: { serverId: string; tool: MonitoringTool; password?: string };
    result: void;
  };
  "monitoring:enableAppMetrics": {
    args: { serverId: string; password?: string };
    result: void;
  };
  "metrics:app": {
    args: { projectId: string; password?: string };
    result: Pm2ProcessHealth | null;
  };
  "metrics:traffic": {
    args: { projectId: string; password?: string };
    result: TrafficStats;
  };
  "metrics:statusTabCache": { args: string; result: AppStatusTabCache | null };
  "metrics:statusTabCacheSave": {
    args: { projectId: string; patch: Partial<Omit<AppStatusTabCache, "cachedAt">> };
    result: void;
  };
  "metrics:server": {
    args: { serverId: string; seconds: number; password?: string };
    result: ServerMetrics;
  };
  "metrics:appHistory": {
    args: { projectId: string; seconds: number; password?: string };
    result: AppMetricsHistory;
  };
  "metrics:appLogActivity": {
    args: { projectId: string; password?: string };
    result: AppLogPoint[];
  };

  "deploy:run": {
    args: { projectId: string; password?: string; legacyPeerDeps?: boolean };
    result: { url?: string };
  };
  "deploy:rollback": {
    args: { projectId: string; password?: string };
    result: { url?: string };
  };
  "versions:external": {
    args: { projectId: string; password?: string };
    result: ExternalVersions;
  };
  "versions:externalState": {
    args: { projectId: string; password?: string };
    result: ExternalSyncState;
  };
  "deploy:rollbackExternal": {
    args: { projectId: string; commit: string; password?: string };
    result: { url?: string };
  };
  "projects:migrate": {
    args: { projectId: string; password?: string };
    result: { url?: string };
  };
  "external:setupHttps": {
    args: { projectId: string; password?: string };
    result: void;
  };
  "external:enableAccessLog": {
    args: { projectId: string; password?: string };
    result: { logPath: string };
  };
  "deploy:active": { args: void; result: DeployStartedEvent[] };
  "deploy:state": { args: string; result: DeployRunState | null };

  "logs:streamStart": {
    args: { projectId: string; source: LogStreamSource; password?: string };
    result: { streamId: string };
  };
  "logs:streamStop": { args: string; result: void };

  "open-external": { args: string; result: void };
}

/** Push events main sends to the renderer: channel → payload. Senders in main
 *  and the `ipcRenderer.on` subscriptions in preload both check against it */
export interface IpcEventMap {
  "deploy:log": { projectId: string; seq: number; line: string };
  "deploy:started": DeployStartedEvent;
  "deploy:finished": DeployFinishedEvent;
  "logs:stream-data": { streamId: string; channel: "out" | "err"; text: string };
  "logs:stream-end": { streamId: string };
  "deploy:open-project": { projectId: string };
}

/**
 * The api preload exposes as window.plantar. The implementation in
 * preload/index.ts is annotated with this type, and every method body goes
 * through the registry-typed `invoke`/`subscribe` wrappers — so a method
 * whose declared shape drifts from its channel's contract fails typecheck.
 */
export interface PlantarApi {
  listServers: () => Promise<IpcResult<ServerRecord[]>>;
  addServer: (input: AddServerInput) => Promise<IpcResult<ServerRecord>>;
  removeServer: (id: string) => Promise<IpcResult<void>>;
  /** Порядок серверов в сайдбаре, заданный перетаскиванием */
  reorderServers: (ids: string[]) => Promise<IpcResult<void>>;
  /** Готовые приватные ключи из ~/.ssh — для способа входа «ключ уже настроен» */
  detectSshKeys: () => Promise<IpcResult<DetectedSshKey[]>>;
  /** Выбор файла приватного ключа в системном диалоге; null — выбор отменён */
  pickSshKeyFile: () => Promise<IpcResult<string | null>>;
  /** Серверы из ~/.ssh/config — подсказки для предзаполнения формы */
  listSshConfigHosts: () => Promise<IpcResult<SshConfigHost[]>>;

  listProjects: () => Promise<IpcResult<ProjectRecord[]>>;
  /** Порядок проектов одного сервера в сайдбаре, заданный перетаскиванием */
  reorderProjects: (serverId: string, ids: string[]) => Promise<IpcResult<void>>;
  pickProject: () => Promise<IpcResult<PickedProject | null>>;
  listRepoBranches: (repoUrl: string) => Promise<IpcResult<RemoteBranches>>;
  cloneRepo: (repoUrl: string, branch: string) => Promise<IpcResult<PickedProject>>;
  cancelClone: (clonePath: string) => Promise<IpcResult<void>>;
  addProject: (input: AddProjectInput) => Promise<IpcResult<ProjectRecord>>;
  removeProject: (id: string) => Promise<IpcResult<void>>;
  /** Приложения, запущенные на сервере, но ещё не добавленные в Plantar */
  discoverApps: (
    serverId: string,
    password?: string,
  ) => Promise<IpcResult<DiscoveredApp[]>>;
  importProject: (input: ImportProjectInput) => Promise<IpcResult<ProjectRecord>>;
  /** Привязка папки с кодом к импортированному проекту; null — выбор отменён */
  linkProjectFolder: (
    projectId: string,
  ) => Promise<IpcResult<{ project: ProjectRecord; config: ProjectConfig } | null>>;
  /** Подключение обнаруженного GitHub-репозитория к импортированному проекту */
  linkProjectRepo: (
    projectId: string,
  ) => Promise<IpcResult<{ project: ProjectRecord; config: ProjectConfig }>>;
  removeProjectFromServer: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<void>>;
  readProjectConfig: (projectId: string) => Promise<IpcResult<ProjectConfig>>;
  writeProjectConfig: (
    projectId: string,
    config: ProjectConfigInput,
    subdir?: string,
  ) => Promise<IpcResult<ProjectConfig>>;
  /** Смена ветки git-проекта: переключает локальный клон и сохраняет выбор */
  setProjectBranch: (projectId: string, branch: string) => Promise<IpcResult<void>>;
  /** Выбор подпапки проекта внутри клона (только git); null — отмена */
  pickSubdir: (root: string) => Promise<IpcResult<SubdirPick | null>>;
  /** Закэшированный снимок вкладки «Коммиты» (мгновенно); null — кэша ещё нет */
  getCommitsCache: (projectId: string) => Promise<IpcResult<CommitsView | null>>;
  /** Свежий снимок вкладки «Коммиты» (сетевой git fetch); заодно обновляет кэш */
  getCommitsView: (projectId: string) => Promise<IpcResult<CommitsView>>;

  getSettings: () => Promise<IpcResult<AppSettings>>;
  setSettings: (settings: AppSettings) => Promise<IpcResult<void>>;
  /** The port the MCP endpoint will actually use: the running listener's
   *  one, or the stored/default port when it is free; null — the port is
   *  taken and the real one is known only after saving (#63) */
  resolveMcpPort: () => Promise<IpcResult<number | null>>;

  githubAccount: () => Promise<IpcResult<GithubAccount | null>>;
  githubStartLogin: () => Promise<IpcResult<DeviceLogin>>;
  githubPollLogin: (
    deviceCode: string,
    interval: number,
    expiresIn: number,
  ) => Promise<IpcResult<GithubAccount>>;
  githubSignOut: () => Promise<IpcResult<void>>;
  /** Настраивает деплой при коммите: ключ в Secrets, workflow в ветку проекта */
  setupGithubActions: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<SetupActionsResult>>;

  listHistory: (projectId: string) => Promise<IpcResult<DeployRecord[]>>;
  readDeployLog: (logFile: string) => Promise<IpcResult<string>>;

  /** Содержимое папки проекта на сервере; path — относительно корня проекта, "" — корень */
  listProjectFiles: (
    projectId: string,
    path: string,
    password?: string,
  ) => Promise<IpcResult<RemoteFileEntry[]>>;
  /** Текст файла из папки проекта; большой файл приходит хвостом, бинарный — без текста */
  readProjectFile: (
    projectId: string,
    path: string,
    password?: string,
  ) => Promise<IpcResult<RemoteFileContent>>;
  /** Текст связанного nginx-файла по его id */
  readRelatedFile: (
    projectId: string,
    related: RelatedFileId,
    password?: string,
  ) => Promise<IpcResult<RemoteFileContent>>;
  /** Связанные nginx-файлы сайта; у внешних приложений и ботов — пусто */
  listRelatedFiles: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<RelatedFile[]>>;

  readEnv: (projectId: string, password?: string) => Promise<IpcResult<string>>;
  writeEnv: (
    projectId: string,
    content: string,
    password?: string,
  ) => Promise<IpcResult<void>>;
  listLocalEnvFiles: (projectId: string) => Promise<IpcResult<string[]>>;
  readLocalEnvFile: (projectId: string, file: string) => Promise<IpcResult<string>>;

  getServerInfo: (serverId: string, password?: string) => Promise<IpcResult<ServerInfo>>;
  /** Есть ли живое соединение с сервером — тогда пароль не понадобится */
  isServerConnected: (serverId: string) => Promise<IpcResult<boolean>>;
  /** Живые статусы приложений сервера (один запрос); заодно обновляет кэш */
  getAppStatuses: (serverId: string) => Promise<IpcResult<AppStatusEntry>>;
  /** Кэш статусов приложений по serverId — снимок прошлой проверки */
  getAppStatusCache: () => Promise<IpcResult<Record<string, AppStatusEntry>>>;
  /** Что из инструментов мониторинга установлено на сервере */
  getMonitoringStatus: (
    serverId: string,
    password?: string,
  ) => Promise<IpcResult<MonitoringStatus>>;
  /** Установка инструмента мониторинга; уже установленный пропускается */
  installMonitoringTool: (
    serverId: string,
    tool: MonitoringTool,
    password?: string,
  ) => Promise<IpcResult<void>>;
  /** Включает сбор нагрузки приложений: Netdata + сборщик с cron */
  enableAppMetrics: (
    serverId: string,
    password?: string,
  ) => Promise<IpcResult<void>>;
  /** Здоровье pm2-процесса приложения; null — процесса на сервере нет */
  getAppHealth: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<Pm2ProcessHealth | null>>;
  /** Посещаемость приложения по access-логу nginx (нужен GoAccess) */
  getTrafficStats: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<TrafficStats>>;
  /** Кэш вкладки «Статус» проекта — данные прошлого открытия */
  getStatusTabCache: (
    projectId: string,
  ) => Promise<IpcResult<AppStatusTabCache | null>>;
  /** Дописывает загруженную часть вкладки в кэш для следующего открытия */
  saveStatusTabCache: (
    projectId: string,
    patch: Partial<Omit<AppStatusTabCache, "cachedAt">>,
  ) => Promise<IpcResult<void>>;
  /** История нагрузки сервера за час или сутки (нужен Netdata) */
  getServerMetrics: (
    serverId: string,
    seconds: number,
    password?: string,
  ) => Promise<IpcResult<ServerMetrics>>;
  /** История нагрузки приложения за час или сутки; пустые ряды — данные копятся */
  getAppMetricsHistory: (
    projectId: string,
    seconds: number,
    password?: string,
  ) => Promise<IpcResult<AppMetricsHistory>>;
  /** Активность логов приложения за сутки по часам; пусто — данные копятся */
  getAppLogActivity: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<AppLogPoint[]>>;
  deploy: (
    projectId: string,
    password?: string,
    legacyPeerDeps?: boolean,
  ) => Promise<IpcResult<{ url?: string }>>;
  /** Возврат предыдущей версии; лог приходит в onDeployLog */
  rollback: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<{ url?: string }>>;
  /** Git-версии внешнего проекта с сервера — вкладка «Версии» */
  externalVersions: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<ExternalVersions>>;
  /** Лёгкая локальная проверка (без fetch) для индикатора на «Статусе» */
  externalSyncState: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<ExternalSyncState>>;
  /** Возврат версии внешнего проекта: повторный деплой выбранного коммита */
  rollbackExternalTo: (
    projectId: string,
    commit: string,
    password?: string,
  ) => Promise<IpcResult<{ url?: string }>>;
  /** Перенос импортированного проекта под управление Plantar (takeover-деплой) */
  migrateProject: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<{ url?: string }>>;
  /** In-place HTTPS for an imported app: certbot amends its own nginx
   *  config — no move under Plantar management */
  setupExternalHttps: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<void>>;
  /** A separate visits log for an imported app: one added line in its
   *  nginx config, with a backup and verification */
  enableExternalAccessLog: (
    projectId: string,
    password?: string,
  ) => Promise<IpcResult<{ logPath: string }>>;
  /** Состояние прогона деплоя: живое из памяти main, после перезапуска —
   *  последний прогон с диска; null — проект ни разу не деплоили */
  getDeployState: (
    projectId: string,
  ) => Promise<IpcResult<DeployRunState | null>>;
  /** Идущие сейчас прогоны — начальное состояние индикаторов в сайдбаре */
  getActiveDeploys: () => Promise<IpcResult<DeployStartedEvent[]>>;

  /** Живой хвост логов: события приходят в onLogStreamData до stopLogStream */
  startLogStream: (
    projectId: string,
    source: LogStreamSource,
    password?: string,
  ) => Promise<IpcResult<{ streamId: string }>>;
  stopLogStream: (streamId: string) => Promise<IpcResult<void>>;

  openExternal: (url: string) => Promise<IpcResult<void>>;

  onDeployLog: (
    callback: (event: IpcEventMap["deploy:log"]) => void,
  ) => () => void;
  /** Старт прогона деплоя или возврата версии (любого проекта) */
  onDeployStarted: (
    callback: (event: DeployStartedEvent) => void,
  ) => () => void;
  /** Завершение прогона деплоя или возврата версии (любого проекта) */
  onDeployFinished: (
    callback: (event: DeployFinishedEvent) => void,
  ) => () => void;

  onLogStreamData: (
    callback: (event: IpcEventMap["logs:stream-data"]) => void,
  ) => () => void;
  onLogStreamEnd: (
    callback: (event: IpcEventMap["logs:stream-end"]) => void,
  ) => () => void;

  onOpenProject: (
    callback: (event: IpcEventMap["deploy:open-project"]) => void,
  ) => () => void;
}
