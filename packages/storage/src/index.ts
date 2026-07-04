import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Language, systemLanguage } from "@plantar/i18n";

export type { Language } from "@plantar/i18n";

/** Директория данных Plantar по конвенциям ОС */
export function dataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "plantar");
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
        "plantar",
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
        "plantar",
      );
  }
}

function logsDir(project: string): string {
  const dir = path.join(dataDir(), "logs", project);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Пишет лог деплоя в файл по мере выполнения */
export class DeployLogWriter {
  readonly file: string;

  constructor(project: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = path.join(logsDir(project), `deploy-${timestamp}.log`);
    writeFileSync(this.file, "");
  }

  write(line: string): void {
    appendFileSync(this.file, line + "\n");
  }
}

/** Сохраняет последний скачанный серверный лог; возвращает путь к файлу */
export function saveServerLogSnapshot(
  project: string,
  kind: "access" | "error",
  content: string,
): string {
  const file = path.join(logsDir(project), `nginx-${kind}.log`);
  writeFileSync(file, content);
  return file;
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
}

export interface ProjectRecord {
  id: string;
  serverId: string;
  /** name из plantar.json на момент добавления */
  name: string;
  path: string;
}

function readJsonList<T>(file: string): T[] {
  const full = path.join(dataDir(), file);
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, "utf8")) as T[];
}

function writeJsonList<T>(file: string, list: T[]): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), file), JSON.stringify(list, null, 2));
}

export interface AppSettings {
  /** Сохранять локальные копии серверных логов при каждом просмотре */
  saveServerLogCopies: boolean;
  /** Email для Let's Encrypt (уведомления о проблемах с сертификатами); пусто — без email */
  letsEncryptEmail: string;
  /** Показывать системное уведомление об успешном деплое (об ошибке — всегда) */
  notifyOnDeploySuccess: boolean;
  /** Язык интерфейса */
  language: Language;
}

const DEFAULT_SETTINGS: AppSettings = {
  saveServerLogCopies: true,
  letsEncryptEmail: "",
  notifyOnDeploySuccess: true,
  language: systemLanguage(),
};

export function readSettings(): AppSettings {
  const file = path.join(dataDir(), "settings.json");
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, "utf8")) as object) };
}

export function writeSettings(settings: AppSettings): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), "settings.json"), JSON.stringify(settings, null, 2));
}

export const readServers = () => readJsonList<ServerRecord>("servers.json");
export const writeServers = (list: ServerRecord[]) => writeJsonList("servers.json", list);
export const readProjects = () => readJsonList<ProjectRecord>("projects.json");
export const writeProjects = (list: ProjectRecord[]) => writeJsonList("projects.json", list);

/** Директория для SSH-ключей, которые Plantar создаёт сам */
export function keysDir(): string {
  const dir = path.join(dataDir(), "keys");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export interface DeployRecord {
  project: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "error";
  url?: string;
  error?: string;
  logFile: string;
}

function historyFile(): string {
  return path.join(dataDir(), "history.json");
}

export function readHistory(): DeployRecord[] {
  if (!existsSync(historyFile())) return [];
  return JSON.parse(readFileSync(historyFile(), "utf8")) as DeployRecord[];
}

export function appendHistory(record: DeployRecord): void {
  mkdirSync(dataDir(), { recursive: true });
  const history = readHistory();
  history.push(record);
  writeFileSync(historyFile(), JSON.stringify(history, null, 2));
}
