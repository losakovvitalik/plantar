import { readJsonList, writeJsonList } from "./json-store";

/** A key a server identifies itself with: the algorithm it names
 *  ("ssh-ed25519", "ssh-rsa", …) and its OpenSSH "SHA256:…" fingerprint */
export interface HostKeyRecord {
  type: string;
  fingerprint: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  /** password-серверы не хранят секрет — пароль запрашивается при каждом подключении */
  auth: "key" | "password";
  keyPath?: string;
  /** A host key recorded before key types were kept with them: a fingerprint
   *  whose type is unknown. Still required to match, and the connection that
   *  matches it replaces it with a typed entry in hostKeys. */
  hostKeyFingerprint?: string;
  /** The host keys the server has identified itself with, at most one per type,
   *  the way known_hosts keeps them. A key of a type already here has to match
   *  it; a type not here yet is recorded on first sight — that is a server
   *  gaining a key, not a server being replaced. */
  hostKeys?: HostKeyRecord[];
}

/** Коммит, задеплоенный в последний раз (для git-проектов) */
export interface DeployedCommit {
  hash: string;
  message: string;
}

/** Приложение, обнаруженное на сервере при импорте: где оно живёт и как им управлять */
export interface ExternalAppInfo {
  /** Имя pm2-процесса на сервере; может отличаться от имени проекта */
  pm2Name: string;
  /** Папка приложения на сервере — бережный деплой обновляет код прямо в ней */
  appDir: string;
  /** Прежний конфиг nginx; отключается при переносе под управление Plantar */
  nginxConfFile?: string;
  /** Пути логов pm2-процесса — у чужих процессов бывают нестандартными */
  outLogPath?: string;
  errLogPath?: string;
  /** Пути логов nginx из прежнего конфига */
  accessLogPath?: string;
  errorLogPath?: string;
  /** Git-репозиторий, из которого приложение попало на сервер (https-адрес);
   *  позволяет подключить проект к GitHub вместо выбора локальной папки */
  repoUrl?: string;
  branch?: string;
  /** Папка приложения внутри репозитория; пусто — корень */
  repoSubdir?: string;
  /** Настройки проекта, пока не привязана папка с кодом и нет plantar.json */
  config: {
    name: string;
    type: "static" | "node" | "next" | "bot";
    runtime?: "node" | "python";
    domain?: string;
    port?: number;
  };
}

export interface ProjectRecord {
  id: string;
  serverId: string;
  /** name из plantar.json на момент добавления */
  name: string;
  /** The names the project deployed under before its renames; its earlier
   *  history records and log directories are found by them */
  previousNames?: string[];
  /** Локальная папка проекта; для git-источника — путь к клону в reposDir();
   *  у импортированного с сервера проекта пусто, пока папка не привязана */
  path: string;
  /** Подпапка внутри path, где лежит проект (для монорепозиториев); пусто — корень */
  subdir?: string;
  /** Источник кода; отсутствует у старых записей — считается "local" */
  source?: "local" | "git";
  /** Для source=git: ссылка на репозиторий и выбранная ветка */
  repoUrl?: string;
  branch?: string;
  /** Коммит последнего успешного деплоя: для source=git — из локального клона,
   *  для внешнего проекта — из репозитория приложения на сервере */
  deployedCommit?: DeployedCommit;
  /** Импортирован с сервера и живёт в бережном режиме: деплой обновляет код
   *  в исходной папке приложения, версии — по git-истории на сервере.
   *  Пометка снимается только при явном переносе под управление Plantar. */
  external?: ExternalAppInfo;
}

export const readServers = () => readJsonList<ServerRecord>("servers.json");
export const writeServers = (list: ServerRecord[]) => writeJsonList("servers.json", list);
export const readProjects = () => readJsonList<ProjectRecord>("projects.json");
export const writeProjects = (list: ProjectRecord[]) => writeJsonList("projects.json", list);

/** Every name the project deployed under, the current one first */
export function projectNames(project: ProjectRecord): string[] {
  return [project.name, ...(project.previousNames ?? [])];
}
