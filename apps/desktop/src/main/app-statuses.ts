import { checkSitesRespond, pm2ProcessStatuses } from "@plantar/core";
import {
  type AppStatus,
  type ProjectRecord,
  type ServerRecord,
  readAppStatusCache,
  writeAppStatusCache,
} from "@plantar/storage";
import { withServer } from "./connections";
import { projectHistory, readHistoryStores } from "./project-history";
import { projectSite } from "./records";

/** Статус приложения проекта по карте pm2-процессов сервера (имя → статус)
 *  и адрес сайта для живой HTTP-проверки (у ботов и без конфига адреса нет) */
function appStatusOf(
  project: ProjectRecord,
  pm2: Map<string, string>,
  host: string,
): { status: AppStatus; siteUrl?: string } {
  const { name, type, siteUrl } = projectSite(project, host);
  // Статичный сайт живёт без pm2-процесса
  if (type === "static") return { status: "static", siteUrl };
  // Внешнее приложение работает под прежним именем pm2
  const status = pm2.get(project.external ? project.external.pm2Name : name);
  if (status === "online" || status === "launching") return { status: "running", siteUrl };
  if (status === "errored") return { status: "error", siteUrl };
  return { status: "stopped", siteUrl };
}

/**
 * Statuses of every app on a server in one SSH round trip: a batched
 * `pm2 jlist` plus parallel curl checks of the sites, on one pooled
 * connection. Used by the sidebar refresh and the background monitor; the
 * snapshot is cached for an instant display on the next app start.
 */
export async function collectServerAppStatuses(
  server: ServerRecord,
): Promise<{ apps: Record<string, AppStatus>; checkedAt: string }> {
  const apps: Record<string, AppStatus> = {};
  // Сайт проверяем там, где он должен отвечать: у работающих приложений
  // и у статики, которая хотя бы раз успешно деплоилась
  const sites: { projectId: string; url: string }[] = [];
  await withServer(server, undefined, async (conn) => {
    const pm2 = await pm2ProcessStatuses(conn);
    // One read of each store for the whole sweep — projectHistory would
    // otherwise re-read servers/projects/history per static site
    const stores = readHistoryStores();
    for (const project of stores.projects.filter((p) => p.serverId === server.id)) {
      const { status, siteUrl } = appStatusOf(project, pm2, server.host);
      apps[project.id] = status;
      const deployedStatic =
        status === "static" &&
        projectHistory(project, stores).some((r) => r.status === "success");
      if (siteUrl && (status === "running" || deployedStatic)) {
        sites.push({ projectId: project.id, url: siteUrl });
      }
    }
    const responds = await checkSitesRespond(
      conn,
      sites.map((s) => s.url),
    );
    // Сайт отвечает — «работает» (в том числе статика), нет — «не отвечает»
    sites.forEach((s, i) => {
      apps[s.projectId] = responds[i] ? "running" : "unresponsive";
    });
  });
  const entry = { apps, checkedAt: new Date().toISOString() };
  const cache = readAppStatusCache();
  cache[server.id] = entry;
  writeAppStatusCache(cache);
  return entry;
}
