import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { byLogName } from "./last-run";
import { dataDir, logsDir, safeLogDir } from "./paths";

/** Пишет лог деплоя в файл по мере выполнения */
export class DeployLogWriter {
  readonly file: string;
  /** One descriptor for the whole run: appending per line must not pay an
   *  open+close pair of syscalls on every line of a build log. Null after
   *  close() — the run is over, nothing may write. */
  private fd: number | null;

  constructor(project: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = path.join(logsDir(project), `deploy-${timestamp}.log`);
    this.fd = openSync(this.file, "w");
  }

  write(line: string): void {
    // A write after close() must fail loudly instead of silently hitting a
    // recycled descriptor of some unrelated file
    if (this.fd === null) throw new Error(`deploy log is closed: ${this.file}`);
    writeSync(this.fd, line + "\n");
  }

  /** True once close() released the descriptor: a caller re-entered after a
   *  failure can skip its log line instead of tripping the write-after-close
   *  assertion above */
  get closed(): boolean {
    return this.fd === null;
  }

  /** Releases the descriptor when the run ends; safe to call twice */
  close(): void {
    if (this.fd === null) return;
    const fd = this.fd;
    this.fd = null;
    closeSync(fd);
  }
}

/**
 * Файлы deploy-логов проекта (полные пути), от старых к новым.
 * The directory is keyed by the project name as of the deploy, so a renamed
 * project has one directory per name it deployed under — pass all of them to
 * keep the runs from before the rename reachable.
 */
export function listDeployLogs(projectNames: string[]): string[] {
  const files: string[] = [];
  for (const name of new Set(projectNames)) {
    const dir = path.join(dataDir(), "logs", name);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (/^deploy-.*\.log$/.test(file)) files.push(path.join(dir, file));
    }
  }
  // The same order resolveLastRun uses: by the ISO timestamp in the file name
  return files.sort(byLogName);
}

/**
 * Хвост файла лога, не длиннее maxBytes: логи не ограничены по размеру,
 * и целиком их читать нельзя. Оборванная первая строка отбрасывается.
 */
export function readLogTail(file: string, maxBytes = 512_000): string {
  const size = statSync(file).size;
  if (size <= maxBytes) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    const text = buf.toString("utf8");
    const firstNewline = text.indexOf("\n");
    return firstNewline === -1 ? text : text.slice(firstNewline + 1);
  } finally {
    closeSync(fd);
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

/** Outcome of deleting a project's log directory */
export type RemoveProjectLogsResult = "removed" | "failed" | "invalid-name";

/**
 * Deletes all logs of a project — for when the project itself is removed.
 * "failed" means the directory could not be removed (a locked file);
 * "invalid-name" means the name escapes the logs directory, so nothing was
 * ever there to delete — a failed cleanup must not fail removing the
 * project, so the caller decides.
 */
export function removeProjectLogs(project: string): RemoveProjectLogsResult {
  const dir = safeLogDir(project);
  if (dir === null) return "invalid-name";
  try {
    rmSync(dir, { recursive: true, force: true });
    return "removed";
  } catch {
    return "failed";
  }
}
