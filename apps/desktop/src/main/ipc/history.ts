import path from "node:path";
import { dataDir, readLogTail } from "@plantar/storage";
import { t } from "../i18n";
import { projectHistory } from "../project-history";
import { getProject } from "../records";
import { handle, toResult } from "./util";

export function registerHistoryIpc(): void {
  handle("history:list", (_e, projectId) =>
    toResult(async () => projectHistory(getProject(projectId))),
  );
  handle("history:readLog", (_e, logFile) =>
    toResult(async () => {
      // Читаем только файлы из хранилища логов Plantar
      const logsRoot = path.join(dataDir(), "logs") + path.sep;
      const resolved = path.resolve(logFile);
      if (!resolved.startsWith(logsRoot)) {
        throw new Error(t("invalidLogPath"));
      }
      // Логи не ограничены по размеру — читаем только хвост
      return readLogTail(resolved);
    }),
  );
}
