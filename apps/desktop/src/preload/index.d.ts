import type { DetectedProject, ProjectConfig, ProjectConfigInput } from "@plantar/config";
import type {
  DiscoveredApp,
  LogStreamSource,
  MonitoringStatus,
  MonitoringTool,
  Pm2ProcessHealth,
  ServerInfo,
  ServerMetrics,
  TrafficStats,
} from "@plantar/core";
import type {
  AppSettings,
  AppStatus,
  AppStatusEntry,
  DeployRecord,
  ProjectRecord,
  ServerRecord,
} from "@plantar/storage";

export type {
  AppStatus,
  AppStatusEntry,
  DetectedProject,
  DiscoveredApp,
  LogStreamSource,
  MonitoringStatus,
  MonitoringTool,
  Pm2ProcessHealth,
  ProjectConfig,
  ProjectConfigInput,
  ServerInfo,
  ServerMetrics,
  TrafficStats,
  ProjectRecord,
  ServerRecord,
};

/** Импорт найденного на сервере приложения как внешнего проекта */
export interface ImportProjectInput {
  serverId: string;
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
  default: string;
}

export interface GithubAccount {
  login: string;
  /** Токену разрешено менять файлы автодеплоя в репозитории (scope workflow) */
  canWriteWorkflows: boolean;
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

export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

/** Результат автонастройки деплоя при коммите (GitHub Actions) */
export interface SetupActionsResult {
  branch: string;
  actionsUrl: string;
}

/** code — машинный код ошибки (например npm-peer-conflict) для действий в GUI */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

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
      listRepoBranches: (repoUrl: string) => Promise<IpcResult<RemoteBranches>>;
      cloneRepo: (repoUrl: string, branch: string) => Promise<IpcResult<PickedProject>>;
      cancelClone: (clonePath: string) => Promise<IpcResult<void>>;
      addProject: (input: {
        serverId: string;
        path: string;
        config?: ProjectConfigInput;
        subdir?: string;
        source?: "local" | "git";
        repoUrl?: string;
        branch?: string;
      }) => Promise<IpcResult<ProjectRecord>>;
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
      /** История нагрузки сервера за час или сутки (нужен Netdata) */
      getServerMetrics: (
        serverId: string,
        seconds: number,
        password?: string,
      ) => Promise<IpcResult<ServerMetrics>>;
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

      /** Живой хвост логов: события приходят в onLogStreamData до stopLogStream */
      startLogStream: (
        projectId: string,
        source: LogStreamSource,
        password?: string,
      ) => Promise<IpcResult<{ streamId: string }>>;
      stopLogStream: (streamId: string) => Promise<IpcResult<void>>;

      openExternal: (url: string) => Promise<IpcResult<void>>;

      onDeployLog: (
        callback: (event: { projectId: string; line: string }) => void,
      ) => () => void;

      onLogStreamData: (
        callback: (event: {
          streamId: string;
          channel: "out" | "err";
          text: string;
        }) => void,
      ) => () => void;
      onLogStreamEnd: (callback: (event: { streamId: string }) => void) => () => void;

      onOpenProject: (callback: (event: { projectId: string }) => void) => () => void;
    };
  }
}
