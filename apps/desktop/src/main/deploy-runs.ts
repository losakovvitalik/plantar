import { BrowserWindow } from "electron";
import { t } from "./i18n";

/**
 * Реестр прогонов деплоя. Main — единственный источник правды о состоянии
 * деплоя: renderer при монтировании вкладки запрашивает снимок и дальше
 * живёт на событиях deploy:log / deploy:finished. Завершённый прогон
 * остаётся в реестре как «последний» — не удаляется.
 */

export type DeployKind = "deploy" | "rollback";

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
  error?: string;
  /** Машинный код ошибки (например npm-peer-conflict) для действий в GUI */
  errorCode?: string;
}

interface DeployRun {
  kind: DeployKind;
  status: "running" | "success" | "error";
  lines: string[];
  lastSeq: number;
  startedAt: string;
  lastLineAt: string;
  url?: string;
  error?: string;
  errorCode?: string;
}

export interface DeployRunHandle {
  /** Строка в буфер прогона и живым окнам; запись в файл — забота вызывающего */
  log(line: string): void;
  finish(
    result:
      | { status: "success"; url?: string }
      | { status: "error"; error: string; code?: string },
  ): void;
}

const runs = new Map<string, DeployRun>();

/** Буфер строк ограничен: verbose-лог npm install не должен копиться в памяти */
const MAX_RUN_LINES = 2000;

/** Рассылка только живым окнам: закрытие окна не должно ронять деплой */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Регистрирует прогон; второй одновременный прогон одного проекта запрещён —
 * параллельные запуски дерутся за git-клон (index.lock) и staging-папку.
 * Вызывается до создания файла лога: отказ не должен оставлять пустой файл.
 */
export function startDeployRun(projectId: string, kind: DeployKind): DeployRunHandle {
  if (runs.get(projectId)?.status === "running") {
    throw new Error(t("deployAlreadyRunning"));
  }
  const now = new Date().toISOString();
  const run: DeployRun = {
    kind,
    status: "running",
    lines: [],
    lastSeq: 0,
    startedAt: now,
    lastLineAt: now,
  };
  runs.set(projectId, run);
  return {
    log(line) {
      run.lastSeq += 1;
      run.lastLineAt = new Date().toISOString();
      run.lines.push(line);
      if (run.lines.length > MAX_RUN_LINES) {
        run.lines.splice(0, run.lines.length - MAX_RUN_LINES);
      }
      broadcast("deploy:log", { projectId, seq: run.lastSeq, line });
    },
    finish(result) {
      if (result.status === "success") {
        run.status = "success";
        run.url = result.url;
      } else {
        run.status = "error";
        run.error = result.error;
        run.errorCode = result.code;
      }
      broadcast("deploy:finished", {
        projectId,
        kind: run.kind,
        status: run.status,
        url: run.url,
        error: run.error,
        code: run.errorCode,
      });
    },
  };
}

/** Снимок прогона из памяти; null — в этом запуске приложения прогонов не было */
export function deployRunState(projectId: string): DeployRunState | null {
  const run = runs.get(projectId);
  if (!run) return null;
  return {
    kind: run.kind,
    status: run.status,
    lines: [...run.lines],
    lastSeq: run.lastSeq,
    startedAt: run.startedAt,
    lastLineAt: run.lastLineAt,
    url: run.url,
    error: run.error,
    errorCode: run.errorCode,
  };
}
