import { randomUUID } from "node:crypto";
import path from "node:path";
import { rmSync } from "node:fs";
import { dialog } from "electron";
import {
  detectProjectConfig,
  hasProjectConfig,
  loadProjectConfig,
  parseProjectConfig,
  writeProjectConfig,
} from "@plantar/config";
import { removeDeployedProject } from "@plantar/core";
import {
  type ProjectRecord,
  projectNames,
  readCommitsCache,
  readProjects,
  readStatusTabCache,
  removeProjectHistory,
  removeProjectLogs,
  reposDir,
  writeCommitsCache,
  writeProjects,
  writeStatusTabCache,
} from "@plantar/storage";
import type { AddProjectInput, ImportProjectInput } from "../../shared/ipc";
import { withServer } from "../connections";
import { assertValidBranch, cloneRepo, listCommits, listRemoteBranches, updateRepo } from "../git";
import { getToken } from "../github";
import { t } from "../i18n";
import { projectHistory } from "../project-history";
import {
  assertNameFreeOnServer,
  currentName,
  getProject,
  getServer,
  previousNamesAfterRename,
  projectConfig,
  projectDir,
  resolveSubdir,
} from "../records";
import { activeWindow } from "../window";
import { handle, toResult } from "./util";

/** Выбор папки проекта: возвращает путь, конфиг (если plantar.json уже есть) и автоопределённые настройки */
async function pickProjectFolder() {
  const win = activeWindow();
  if (!win) return null;
  const picked = await dialog.showOpenDialog(win, {
    title: t("pickProjectFolder"),
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;

  const projectPath = picked.filePaths[0];
  return {
    path: projectPath,
    config: hasProjectConfig(projectPath) ? loadProjectConfig(projectPath) : null,
    detected: detectProjectConfig(projectPath),
  };
}

/** Добавляет найденное на сервере приложение как внешний проект (без папки с кодом) */
async function importProject(input: ImportProjectInput): Promise<ProjectRecord> {
  // Called for the throw only: fail before writing a record for a removed server
  getServer(input.serverId);
  const config = parseProjectConfig(input.config);
  assertNameFreeOnServer(input.serverId, config.name);
  // Переменные не копируются в хранилище Plantar: внешний проект читает
  // и сохраняет их прямо в .env своей папки — на сервере ничего не меняется
  const record: ProjectRecord = {
    id: randomUUID(),
    serverId: input.serverId,
    name: config.name,
    path: "",
    external: {
      pm2Name: input.pm2Name,
      appDir: input.appDir,
      nginxConfFile: input.nginxConfFile,
      outLogPath: input.outLogPath,
      errLogPath: input.errLogPath,
      accessLogPath: input.accessLogPath,
      errorLogPath: input.errorLogPath,
      repoUrl: input.repoUrl,
      branch: input.branch,
      repoSubdir: input.repoSubdir,
      config: {
        name: config.name,
        type: config.type,
        runtime: config.runtime,
        domain: config.domain,
        port: config.port,
      },
    },
  };
  writeProjects([...readProjects(), record]);
  return record;
}

function addProject(input: AddProjectInput): ProjectRecord {
  getServer(input.serverId);
  const subdir = resolveSubdir(input.path, input.subdir);
  const dir = subdir ? path.join(input.path, subdir) : input.path;
  const parsedConfig = input.config ? null : loadProjectConfig(dir);
  assertNameFreeOnServer(input.serverId, (input.config ?? parsedConfig!).name);
  const config = input.config ? writeProjectConfig(dir, input.config) : parsedConfig!;
  const record: ProjectRecord = {
    id: randomUUID(),
    serverId: input.serverId,
    name: config.name,
    path: input.path,
    ...(subdir ? { subdir } : {}),
    ...(input.source === "git"
      ? { source: "git" as const, repoUrl: input.repoUrl, branch: input.branch }
      : {}),
  };
  writeProjects([...readProjects(), record]);
  return record;
}

/** Клонирует репозиторий в reposDir() и предзаполняет настройки — как выбор папки */
async function cloneRepoForProject(repoUrl: string, branch: string) {
  const dir = path.join(reposDir(), randomUUID());
  await cloneRepo(repoUrl, branch || undefined, dir, getToken() ?? undefined);
  return {
    path: dir,
    config: hasProjectConfig(dir) ? loadProjectConfig(dir) : null,
    detected: detectProjectConfig(dir),
  };
}

/**
 * Выбор подпапки проекта внутри клона: открывает диалог в корне клона,
 * возвращает repo-относительный путь и настройки, определённые в этой папке.
 */
async function pickSubdir(root: string) {
  const reposRoot = reposDir() + path.sep;
  if (!path.resolve(root).startsWith(reposRoot)) throw new Error(t("subdirOutside"));

  const win = activeWindow();
  if (!win) return null;
  const picked = await dialog.showOpenDialog(win, {
    title: t("pickProjectFolder"),
    defaultPath: root,
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;

  const subdir = resolveSubdir(root, path.relative(root, picked.filePaths[0]));
  const dir = subdir ? path.join(root, subdir) : root;
  return {
    subdir,
    config: hasProjectConfig(dir) ? loadProjectConfig(dir) : null,
    detected: detectProjectConfig(dir),
  };
}

/** Удаляет клон git-проекта; трогает только папки внутри reposDir() */
function removeCloneDir(projectPath: string): void {
  const root = reposDir() + path.sep;
  if (path.resolve(projectPath).startsWith(root)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

export function registerProjectsIpc(): void {
  handle("projects:list", () => toResult(async () => readProjects()));
  // Порядок проектов одного сервера в сайдбаре; позиции проектов других
  // серверов в общем списке не меняются
  handle("projects:reorder", (_e, args) =>
    toResult(async () => {
      const projects = readProjects();
      const own = projects.filter((p) => p.serverId === args.serverId);
      const byId = new Map(own.map((p) => [p.id, p]));
      const ordered = [
        ...args.ids.flatMap((id) => byId.get(id) ?? []),
        ...own.filter((p) => !args.ids.includes(p.id)),
      ];
      let next = 0;
      writeProjects(projects.map((p) => (p.serverId === args.serverId ? ordered[next++] : p)));
    }),
  );
  handle("projects:pick", () => toResult(() => pickProjectFolder()));
  // Список веток репозитория для выпадающего списка в форме добавления
  handle("repo:branches", (_e, repoUrl) =>
    toResult(() => listRemoteBranches(repoUrl, getToken() ?? undefined)),
  );
  // Клонирует репозиторий локально и возвращает предзаполненные настройки
  handle("projects:cloneRepo", (_e, args) =>
    toResult(() => cloneRepoForProject(args.repoUrl, args.branch)),
  );
  // Пользователь закрыл форму, не добавив проект — убираем осиротевший клон
  handle("projects:cancelClone", (_e, clonePath) =>
    toResult(async () => removeCloneDir(clonePath)),
  );
  handle("projects:add", (_e, input) =>
    toResult(async () => addProject(input)),
  );
  handle("projects:import", (_e, input) =>
    toResult(async () => importProject(input)),
  );
  // Привязка папки с кодом к импортированному проекту: создаёт plantar.json
  // из настроек, подтверждённых при импорте, поверх автоопределённых по папке
  handle("projects:linkFolder", (_e, projectId) =>
    toResult(async () => {
      const project = getProject(projectId);
      if (!project.external || project.path) throw new Error(t("linkFolderUnavailable"));
      const win = activeWindow();
      if (!win) return null;
      const picked = await dialog.showOpenDialog(win, {
        title: t("pickProjectFolder"),
        properties: ["openDirectory"],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const dir = picked.filePaths[0];
      const base = hasProjectConfig(dir)
        ? loadProjectConfig(dir)
        : detectProjectConfig(dir).config;
      const config = writeProjectConfig(dir, { ...base, ...project.external.config });
      const updated = readProjects().map((p) =>
        p.id === projectId ? { ...p, path: dir } : p,
      );
      writeProjects(updated);
      return { project: updated.find((p) => p.id === projectId)!, config };
    }),
  );
  // Подключение GitHub-репозитория к импортированному проекту: клонирует репозиторий,
  // из которого приложение было задеплоено на сервер, и переводит проект в git-источник
  handle("projects:linkRepo", (_e, projectId) =>
    toResult(async () => {
      const project = getProject(projectId);
      const repoUrl = project.external?.repoUrl;
      if (!project.external || project.path || !repoUrl) {
        throw new Error(t("linkRepoUnavailable"));
      }
      // Ветку сервера могли удалить или HEAD был отвязан — берём ветку по умолчанию
      const branch =
        project.external.branch ??
        (await listRemoteBranches(repoUrl, getToken() ?? undefined)).default;
      const cloneDir = path.join(reposDir(), randomUUID());
      await cloneRepo(repoUrl, branch, cloneDir, getToken() ?? undefined);
      try {
        const subdir = resolveSubdir(cloneDir, project.external.repoSubdir);
        const dir = subdir ? path.join(cloneDir, subdir) : cloneDir;
        const base = hasProjectConfig(dir)
          ? loadProjectConfig(dir)
          : detectProjectConfig(dir).config;
        const config = writeProjectConfig(dir, { ...base, ...project.external.config });
        const updated = readProjects().map((p) =>
          p.id === projectId
            ? {
                ...p,
                path: cloneDir,
                subdir: subdir || undefined,
                source: "git" as const,
                repoUrl,
                branch,
              }
            : p,
        );
        writeProjects(updated);
        return { project: updated.find((p) => p.id === projectId)!, config };
      } catch (err) {
        // Подключение не удалось (например, папки приложения нет в репозитории) —
        // не оставляем осиротевший клон
        rmSync(cloneDir, { recursive: true, force: true });
        throw err;
      }
    }),
  );
  handle("projects:remove", (_e, id) =>
    toResult(async () => {
      const project = readProjects().find((p) => p.id === id);
      // Resolve the names before the clone goes away — the current one comes
      // from plantar.json. Every name the project deployed under is cleaned up,
      // not only the current one: the runs from before a rename live in the
      // directory of the name of the time
      const names = project
        ? [...new Set([currentName(project), ...projectNames(project)])]
        : [];
      if (project?.source === "git") removeCloneDir(project.path);
      const remaining = readProjects().filter((p) => p.id !== id);
      writeProjects(remaining);
      // The log directory is keyed by name only, so a name is cleaned up only
      // when no remaining project claims it — either as its current name (the
      // same app deployed to a staging and a production server shares one
      // directory) or as a name it was renamed from, whose earlier runs are
      // still in that directory. The history records go with the files: records
      // without an id are keyed by name too, and rows whose log no longer exists
      // would come back if that name were added again
      const claimed = new Set(
        remaining.flatMap((p) => [currentName(p), ...projectNames(p)]),
      );
      for (const name of names) {
        if (claimed.has(name)) continue;
        removeProjectLogs(name);
        removeProjectHistory(name);
      }
      // Убираем осиротевший снимок кэша коммитов
      const cache = readCommitsCache();
      if (id in cache) {
        delete cache[id];
        writeCommitsCache(cache);
      }
      const statusCache = readStatusTabCache();
      if (id in statusCache) {
        delete statusCache[id];
        writeStatusTabCache(statusCache);
      }
    }),
  );
  // Кэш вкладки «Коммиты»: мгновенный показ устаревшего снимка при открытии
  handle("git:commitsCache", (_e, projectId) =>
    toResult(async () => readCommitsCache()[projectId] ?? null),
  );
  // Свежий снимок: коммиты ветки (сетевой git fetch) + статусы деплоев; пишем в кэш
  handle("git:commitsView", (_e, projectId) =>
    toResult(async () => {
      const project = getProject(projectId);
      if (project.source !== "git") return { commits: [], history: [] };
      const commits = await listCommits(
        project.path,
        project.branch!,
        getToken() ?? undefined,
      );
      const history = projectHistory(project);
      const cache = readCommitsCache();
      cache[projectId] = { commits, history, cachedAt: new Date().toISOString() };
      writeCommitsCache(cache);
      return { commits, history };
    }),
  );
  handle(
    "projects:removeFromServer",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        // Имя могли поменять в plantar.json — берём актуальное, с фолбэком
        let name = project.name;
        try {
          name = loadProjectConfig(projectDir(project)).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        await withServer(server, args.password, (conn) => removeDeployedProject(conn, name));
      }),
  );
  handle("projects:readConfig", (_e, projectId) =>
    toResult(async () => projectConfig(getProject(projectId))),
  );
  // Открывает выбор подпапки внутри клона и определяет настройки в ней
  handle("projects:pickSubdir", (_e, root) =>
    toResult(() => pickSubdir(root)),
  );
  handle(
    "projects:writeConfig",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        // Импортированный проект без папки: plantar.json ещё нет,
        // настройки живут в записи проекта
        if (project.external && !project.path) {
          const config = parseProjectConfig(args.config);
          assertNameFreeOnServer(project.serverId, config.name, project.id);
          const external = {
            ...project.external,
            config: {
              name: config.name,
              type: config.type,
              runtime: config.runtime,
              domain: config.domain,
              port: config.port,
            },
          };
          writeProjects(
            readProjects().map((p) =>
              p.id === project.id
                ? {
                    ...p,
                    name: config.name,
                    previousNames: previousNamesAfterRename(p, config.name),
                    external,
                  }
                : p,
            ),
          );
          return config;
        }
        // subdir применим только к git-проектам; для локальных остаётся как был
        const subdir =
          project.source === "git"
            ? resolveSubdir(project.path, args.subdir ?? project.subdir)
            : (project.subdir ?? "");
        const dir = subdir ? path.join(project.path, subdir) : project.path;
        assertNameFreeOnServer(project.serverId, args.config.name, project.id);
        const config = writeProjectConfig(dir, args.config);
        if (config.name !== project.name || subdir !== (project.subdir ?? "")) {
          writeProjects(
            readProjects().map((p) =>
              p.id === project.id
                ? {
                    ...p,
                    name: config.name,
                    previousNames: previousNamesAfterRename(p, config.name),
                    subdir: subdir || undefined,
                  }
                : p,
            ),
          );
        }
        return config;
      }),
  );
  // Смена ветки git-проекта: сразу переключаем локальный клон, чтобы подпапка
  // и настройки читались из выбранной ветки, а не только со следующего деплоя
  handle(
    "projects:setBranch",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        if (project.source !== "git" || !project.path) {
          throw new Error(t("branchNotGit"));
        }
        assertValidBranch(args.branch);
        await updateRepo(project.path, args.branch, getToken() ?? undefined);
        writeProjects(
          readProjects().map((p) =>
            p.id === project.id ? { ...p, branch: args.branch } : p,
          ),
        );
      }),
  );
}
