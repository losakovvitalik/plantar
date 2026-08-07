import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  type ProjectConfig,
  loadProjectConfig,
  parseProjectConfig,
} from "@plantar/config";
import { type RelatedFileId, appBaseDir, nginxRelatedPaths } from "@plantar/core";
import {
  type ProjectRecord,
  type ServerRecord,
  readProjects,
  readServers,
} from "@plantar/storage";
import { t } from "./i18n";

export function getServer(id: string): ServerRecord {
  const server = readServers().find((s) => s.id === id);
  if (!server) throw new Error(t("serverNotFound"));
  return server;
}

export function getProject(id: string): ProjectRecord {
  const project = readProjects().find((p) => p.id === id);
  if (!project) throw new Error(t("projectNotFound"));
  return project;
}

/** Эффективная папка проекта: клон/папка + подпапка (для монорепозиториев) */
export function projectDir(project: Pick<ProjectRecord, "path" | "subdir">): string {
  return project.subdir ? path.join(project.path, project.subdir) : project.path;
}

/** Конфиг проекта: у импортированных без папки живёт в записи, иначе — plantar.json */
export function projectConfig(project: ProjectRecord): ProjectConfig {
  if (project.external && !project.path) {
    return parseProjectConfig(project.external.config);
  }
  return loadProjectConfig(projectDir(project));
}

/** Корень файлов проекта на сервере: у импортированного — его папка, иначе /var/www/<имя> */
export function projectRemoteRoot(project: ProjectRecord): string {
  if (project.external) return project.external.appDir;
  let name = project.name;
  try {
    name = projectConfig(project).name;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
  }
  return appBaseDir(name);
}

/** Абсолютный путь связанного nginx-файла; у внешних приложений и ботов nginx-файлов нет */
export function relatedFilePath(project: ProjectRecord, id: RelatedFileId): string {
  if (project.external) throw new Error(t("fileNotFound"));
  const config = projectConfig(project);
  const found =
    config.type === "bot"
      ? undefined
      : nginxRelatedPaths(config.name).find((file) => file.id === id);
  if (!found) throw new Error(t("fileNotFound"));
  return found.path;
}

/** The name the project goes by now: from plantar.json, with the record as fallback */
export function currentName(project: ProjectRecord): string {
  try {
    return projectConfig(project).name;
  } catch {
    /* plantar.json недоступен — используем имя на момент добавления */
    return project.name;
  }
}

/**
 * The names the project was renamed from: the history records and the log
 * directory stay under the old name, so the name is remembered, not lost
 */
export function previousNamesAfterRename(
  project: ProjectRecord,
  name: string,
): string[] | undefined {
  if (name === project.name) return project.previousNames;
  return [...new Set([...(project.previousNames ?? []), project.name])];
}

/**
 * Name and type of a project as plantar.json defines them (the record is the
 * fallback when the config is unreadable) plus the site URL — the same address
 * the post-deploy smoke test checks. Bots and unconfigured apps have no URL.
 */
export function projectSite(
  project: ProjectRecord,
  host: string,
): { name: string; type?: string; siteUrl?: string } {
  let name = project.name;
  let type: string | undefined;
  let domain: string | undefined;
  try {
    const config = projectConfig(project);
    name = config.name;
    type = config.type;
    domain = config.domain;
  } catch {
    // plantar.json is unreadable — fall back to the name at add time
  }
  const siteUrl =
    type && type !== "bot"
      ? domain
        ? `https://${domain}/`
        : `http://${host}/`
      : undefined;
  return { name, type, siteUrl };
}

/**
 * Нормализует подпапку в repo-относительный POSIX-путь и проверяет, что она
 * существует внутри root и является директорией. Возвращает "" для корня.
 */
export function resolveSubdir(root: string, subdir: string | undefined): string {
  const clean = (subdir ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean === ".") return "";
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(t("subdirOutside"));
  }
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new Error(t("subdirMissing", { subdir: clean }));
  }
  return clean;
}

/** Два проекта с одним name на одном сервере деплоились бы в один /var/www/<name> */
export function assertNameFreeOnServer(
  serverId: string,
  name: string,
  excludeProjectId?: string,
): void {
  const clash = readProjects().find((p) => {
    if (p.serverId !== serverId || p.id === excludeProjectId) return false;
    let existingName = p.name;
    try {
      existingName = projectConfig(p).name;
    } catch {
      /* plantar.json недоступен — используем имя на момент добавления */
    }
    return existingName === name;
  });
  if (clash) {
    throw new Error(t("nameTaken", { name, path: clash.path }));
  }
}
