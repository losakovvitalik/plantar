import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
