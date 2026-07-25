import path from "node:path";
import type { DeployRecord } from "./index";

/**
 * Какой прогон считать последним для проекта: свежайший deploy-*.log
 * сверяется со списком истории (без обращения к диску — чистая логика,
 * покрыта тестами).
 */
export interface LastDeployRun {
  /** Путь (или имя) файла лога прогона */
  logFile: string;
  /** Запись истории; отсутствует — прогон был прерван (файл без записи) */
  record?: DeployRecord;
}

const LOG_NAME_RE = /deploy-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.log$/;

/** Метка времени из имени deploy-лога (ISO); null — имя не по конвенции */
export function deployLogTimestamp(file: string): string | null {
  const m = LOG_NAME_RE.exec(path.basename(file));
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}

/**
 * Порядок файлов deploy-логов: имя содержит ISO-метку времени, поэтому
 * сравнение имён — это сравнение по времени.
 *
 * By base name, not by the whole path: a renamed project has one log directory
 * per name it deployed under, and whole paths would sort by directory once
 * several of them are mixed. Codepoint comparison rather than localeCompare —
 * these names are fixed-format ASCII, and locale collation has its own ideas
 * about the hyphens the timestamp is built from.
 */
export function byLogName(a: string, b: string): number {
  const left = path.basename(a);
  const right = path.basename(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Последний прогон проекта. logFiles — файлы deploy-*.log из папки логов
 * проекта, history — записи истории этого проекта в хронологическом порядке.
 *
 * Файл, упомянутый в истории, дублирует её запись — прерванным считается
 * только файл новее последней записи (приложение закрыли посреди деплоя).
 * Осиротевший файл старее последней записи игнорируется, как и файл
 * с нечитаемой меткой времени.
 */
export function resolveLastRun(
  logFiles: string[],
  history: DeployRecord[],
): LastDeployRun | null {
  const latest = [...logFiles].sort(byLogName).at(-1);
  const lastRecord = history.at(-1);
  if (latest) {
    const known = history.some(
      (r) => path.basename(r.logFile) === path.basename(latest),
    );
    const fileTime = deployLogTimestamp(latest);
    if (
      !known &&
      (!lastRecord || (fileTime !== null && fileTime > lastRecord.startedAt))
    ) {
      return { logFile: latest };
    }
  }
  return lastRecord ? { logFile: lastRecord.logFile, record: lastRecord } : null;
}
