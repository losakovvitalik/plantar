import { readJsonList, writeJsonList } from "./json-store";

/** A key a server identifies itself with: the algorithm it names
 *  ("ssh-ed25519", "ssh-rsa", …) and its OpenSSH "SHA256:…" fingerprint.
 *  Twin of `HostKey` in @plantar/ssh: values cross between the two on
 *  structural typing alone (this package deliberately keeps no dependency on
 *  @plantar/ssh), so a field added to one has to be added to the other by
 *  hand — nothing here will fail to compile if it is not. */
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
  /** The host keys the server has identified itself with, at most one per type
   *  — in practice one: the app refuses a key whose type is not here, so the
   *  first key recorded is the only one, and a second entry can appear only if
   *  that policy is relaxed later. A key of a type here has to match it. */
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
  /** Deploy on commit is set up: the GitHub repository holds its own copy of
   *  the server's host key, which does not follow the record when a
   *  reinstalled server's new key is trusted — the app reads this marker to
   *  name the projects that must be set up again. Recorded when the setup
   *  completes; a record written before the field existed gets it backfilled
   *  from the deploy workflow the setup left in the repository. Absent means
   *  no evidence of a setup was found, which reads as not set up. */
  deployOnCommit?: boolean;
}

export const readServers = () => readJsonList<ServerRecord>("servers.json");
export const writeServers = (list: ServerRecord[]) => writeJsonList("servers.json", list);
export const readProjects = () => readJsonList<ProjectRecord>("projects.json");
export const writeProjects = (list: ProjectRecord[]) => writeJsonList("projects.json", list);

/** Every name the project deployed under, the current one first */
export function projectNames(project: ProjectRecord): string[] {
  return [project.name, ...(project.previousNames ?? [])];
}
