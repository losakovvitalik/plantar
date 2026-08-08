import {
  SHARED_LOG_TRAFFIC,
  enableAppMetrics,
  ensureAppMetricsScript,
  getAppLogActivity,
  getAppMetricsHistory,
  getMonitoringStatus,
  getServerMetrics,
  getTrafficStats,
  installMonitoringTool,
  markSharedLog,
  pm2ProcessHealth,
} from "@plantar/core";
import { readProjects, readStatusTabCache, writeStatusTabCache } from "@plantar/storage";
import { DAY, HOUR } from "../../shared/chart-windows";
import type { AppStatusTabCache } from "../../shared/ipc";
import { withServer } from "../connections";
import { t } from "../i18n";
import { getProject, getServer, projectConfig } from "../records";
import { trafficLogPath } from "../traffic-log";
import { handle, toResult } from "./util";

export function registerMetricsIpc(): void {
  handle(
    "monitoring:status",
    (_e, args) =>
      toResult(async () =>
        withServer(getServer(args.serverId), args.password, (conn) =>
          getMonitoringStatus(conn),
        ),
      ),
  );
  handle(
    "monitoring:install",
    (_e, args) =>
      toResult(async () => {
        // Имя инструмента попадает в shell-команду установки — только известные
        if (args.tool !== "goaccess" && args.tool !== "netdata") {
          throw new Error(t("unknownMonitoringTool"));
        }
        await withServer(getServer(args.serverId), args.password, (conn) =>
          installMonitoringTool(conn, args.tool),
        );
      }),
  );
  // Включает сбор нагрузки приложений: Netdata + скрипт-сборщик с cron
  handle(
    "monitoring:enableAppMetrics",
    (_e, args) =>
      toResult(async () => {
        await withServer(getServer(args.serverId), args.password, (conn) =>
          enableAppMetrics(conn),
        );
      }),
  );

  // Здоровье pm2-процесса приложения; null — процесса на сервере нет
  handle(
    "metrics:app",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const pm2Name = project.external ? project.external.pm2Name : name;
        const health = await withServer(server, args.password, (conn) =>
          pm2ProcessHealth(conn),
        );
        return health.get(pm2Name) ?? null;
      }),
  );

  // Посещаемость приложения по access-логу nginx (нужен GoAccess на сервере)
  handle(
    "metrics:traffic",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const logPath = trafficLogPath(project, name);
        // No log of its own — there is nothing to read, so no connection either
        if (logPath === null) return SHARED_LOG_TRAFFIC;
        const stats = await withServer(server, args.password, (conn) =>
          getTrafficStats(conn, logPath),
        );
        return markSharedLog(Boolean(project.external), stats);
      }),
  );

  // Кэш вкладки «Статус»: мгновенный показ устаревшего снимка при открытии.
  // Storage keeps the entry fields opaque (unknown) — the desktop app owns
  // their shape, so the read is asserted to the shared AppStatusTabCache
  handle("metrics:statusTabCache", (_e, projectId) =>
    toResult(
      async () =>
        (readStatusTabCache()[projectId] as AppStatusTabCache | undefined) ?? null,
    ),
  );
  // Каждая карточка вкладки пишет своё поле по мере загрузки — патч, не замена
  handle(
    "metrics:statusTabCacheSave",
    (_e, args) =>
      toResult(async () => {
        const cache = readStatusTabCache();
        cache[args.projectId] = {
          ...cache[args.projectId],
          ...args.patch,
          cachedAt: new Date().toISOString(),
        };
        writeStatusTabCache(cache);
      }),
  );

  // История нагрузки сервера из Netdata; окно — час или сутки
  handle(
    "metrics:server",
    (_e, args) =>
      toResult(async () => {
        // The untrusted renderer value is clamped to a known window
        const seconds = args.seconds === DAY ? DAY : HOUR;
        // Проекты сервера подписывают ряды разбивки по приложениям
        const apps = readProjects()
          .filter((p) => p.serverId === args.serverId)
          .map((p) => {
            let name = p.name;
            try {
              name = projectConfig(p).name;
            } catch {
              /* plantar.json недоступен — используем имя на момент добавления */
            }
            // The resolved name, so the usage series match the app cards after a rename
            return { pm2Name: p.external ? p.external.pm2Name : name, name };
          });
        return withServer(getServer(args.serverId), args.password, async (conn) => {
          await ensureAppMetricsScript(conn);
          return getServerMetrics(conn, seconds, apps);
        });
      }),
  );

  // История нагрузки приложения из Netdata; окно — час или сутки
  handle(
    "metrics:appHistory",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const pm2Name = project.external ? project.external.pm2Name : name;
        const seconds = args.seconds === DAY ? DAY : HOUR;
        return withServer(server, args.password, (conn) =>
          getAppMetricsHistory(conn, pm2Name, seconds),
        );
      }),
  );

  // Активность логов приложения за сутки (нужен включённый сбор нагрузки)
  handle(
    "metrics:appLogActivity",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        const pm2Name = project.external ? project.external.pm2Name : name;
        return withServer(server, args.password, (conn) =>
          getAppLogActivity(conn, pm2Name),
        );
      }),
  );
}
