import { mkdirSync } from "node:fs";
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

export function logsDir(project: string): string {
  const dir = path.join(dataDir(), "logs", project);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Директория для SSH-ключей, которые Plantar создаёт сам */
export function keysDir(): string {
  const dir = path.join(dataDir(), "keys");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Директория для локальных клонов git-репозиториев проектов */
export function reposDir(): string {
  const dir = path.join(dataDir(), "repos");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Log directory of a project, or null when the name escapes <dataDir>/logs */
export function safeLogDir(project: string): string | null {
  const root = path.join(dataDir(), "logs") + path.sep;
  const dir = path.resolve(path.join(dataDir(), "logs", project));
  return dir.startsWith(root) ? dir : null;
}
