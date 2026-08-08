import { checkSitesRespond, pm2ProcessStatuses } from "@plantar/core";
import {
  type AppStatus,
  type ProjectRecord,
  type ServerRecord,
  readAppStatusCache,
  writeAppStatusCache,
} from "@plantar/storage";
import { withServer } from "./connections";
import { type NameResolver, projectHistory, readHistoryStores } from "./project-history";
import { projectSite } from "./records";

/** Name, type and site address of a project as its plantar.json defines them */
type ProjectSite = ReturnType<typeof projectSite>;

/** Статус приложения проекта по карте pm2-процессов сервера (имя → статус)
 *  и адрес сайта для живой HTTP-проверки (у ботов и без конфига адреса нет) */
function appStatusOf(
  project: ProjectRecord,
  pm2: Map<string, string>,
  site: ProjectSite,
): { status: AppStatus; siteUrl?: string } {
  const { name, type, siteUrl } = site;
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
    // One read of each project's plantar.json too: both the status of an app
    // and the names historyIdentity treats as taken by another project on the
    // host come from the config, so without this the sweep would re-read every
    // same-host config per static site. The cached siteUrl is pinned to this
    // server's host, which stays right even for a project of another server:
    // historyIdentity only asks the resolver about projects it has already
    // filtered down to server.host
    const resolved = new Map<string, ProjectSite>();
    const siteOf = (project: ProjectRecord): ProjectSite => {
      let site = resolved.get(project.id);
      if (!site) {
        site = projectSite(project, server.host);
        resolved.set(project.id, site);
      }
      return site;
    };
    const nameOf: NameResolver = (project) => siteOf(project).name;
    for (const project of stores.projects.filter((p) => p.serverId === server.id)) {
      const { status, siteUrl } = appStatusOf(project, pm2, siteOf(project));
      apps[project.id] = status;
      const deployedStatic =
        status === "static" &&
        projectHistory(project, stores, nameOf).some((r) => r.status === "success");
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
