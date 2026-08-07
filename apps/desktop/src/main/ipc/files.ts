import {
  type ProjectConfig,
} from "@plantar/config";
import {
  getRelatedFiles,
  listProjectDir,
  readRemoteTextFile,
  resolveProjectPath,
} from "@plantar/core";
import { withServer } from "../connections";
import {
  getProject,
  getServer,
  projectConfig,
  projectRemoteRoot,
  relatedFilePath,
} from "../records";
import { handle, toResult } from "./util";

export function registerFilesIpc(): void {
  // Таб «Файлы»: просмотр папки проекта на сервере, строго на чтение
  handle(
    "files:list",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        return withServer(getServer(project.serverId), args.password, (conn) =>
          listProjectDir(conn, projectRemoteRoot(project), args.path),
        );
      }),
  );
  handle(
    "files:read",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const absPath = args.related
          ? relatedFilePath(project, args.related)
          : resolveProjectPath(projectRemoteRoot(project), args.path ?? "");
        return withServer(getServer(project.serverId), args.password, (conn) =>
          readRemoteTextFile(conn, absPath),
        );
      }),
  );
  handle("files:related", (_e, args) =>
    toResult(async () => {
      const project = getProject(args.projectId);
      if (project.external) return [];
      let config: ProjectConfig;
      try {
        config = projectConfig(project);
      } catch {
        // plantar.json недоступен — nginx-файлы этого проекта неизвестны
        return [];
      }
      if (config.type === "bot") return [];
      return withServer(getServer(project.serverId), args.password, (conn) =>
        getRelatedFiles(conn, config.name),
      );
    }),
  );
}
