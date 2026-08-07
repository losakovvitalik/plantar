import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readExternalEnv, readProjectEnv, writeExternalEnv, writeProjectEnv } from "@plantar/core";
import { withServer } from "../connections";
import { t } from "../i18n";
import { getProject, getServer, projectConfig, projectDir } from "../records";
import { handle, toResult } from "./util";

// Локальные .env-файлы из папки проекта — только на чтение, для импорта на сервер
const ENV_FILE_RE = /^\.env[\w.-]*$/;

export function registerEnvIpc(): void {
  // Переменные проекта хранятся на сервере (вне папки версии) и применяются
  // при деплое; у внешних проектов читаются и сохраняются прямо в .env
  // папки приложения — хранилище Plantar на сервере не создаётся
  handle("env:read", (_e, args) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      if (project.external) {
        const appDir = project.external.appDir;
        return withServer(getServer(project.serverId), args.password, (conn) =>
          readExternalEnv(conn, appDir),
        );
      }
      const config = projectConfig(project);
      return withServer(getServer(project.serverId), args.password, (conn) =>
        readProjectEnv(conn, config.name),
      );
    }),
  );
  handle(
    "env:write",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        if (project.external) {
          const appDir = project.external.appDir;
          await withServer(getServer(project.serverId), args.password, (conn) =>
            writeExternalEnv(conn, appDir, args.content),
          );
          return;
        }
        const config = projectConfig(project);
        await withServer(getServer(project.serverId), args.password, (conn) =>
          writeProjectEnv(conn, config.name, args.content),
        );
      }),
  );

  handle("env:listLocal", (_e, projectId) =>
    toResult(async () => {
      const project = getProject(projectId);
      // У импортированного проекта без папки локальных файлов нет
      if (!project.path) return [];
      return readdirSync(projectDir(project))
        .filter((f) => ENV_FILE_RE.test(f))
        .sort();
    }),
  );
  handle("env:readLocal", (_e, args) =>
    toResult(async () => {
      if (!ENV_FILE_RE.test(args.file)) throw new Error(t("invalidEnvFileName"));
      return readFileSync(path.join(projectDir(getProject(args.projectId)), args.file), "utf8");
    }),
  );
}
