import { appAccessLogPath } from "@plantar/core/paths";
import {
  enableExternalAccessLog,
  getExternalSyncState,
  getExternalVersions,
  setupExternalHttps,
} from "@plantar/core";
import { readProjects, readSettings, writeProjects } from "@plantar/storage";
import { withServer } from "../connections";
import { runDeploy, runExternalInPlace, runRollback } from "../deploy-orchestrators";
import { activeDeployRuns, deployRunState } from "../deploy-runs";
import { t } from "../i18n";
import { projectConfig, getProject, getServer } from "../records";
import { restoredDeployState } from "../project-history";
import { handle, toResult } from "./util";

export function registerDeployIpc(): void {
  handle(
    "deploy:run",
    (_e, args) =>
      toResult(() => runDeploy(args.projectId, args.password, args.legacyPeerDeps)),
  );
  handle("deploy:rollback", (_e, args) =>
    toResult(() => runRollback(args.projectId, args.password)),
  );
  // Git-версии внешнего проекта с сервера — для вкладки «Версии»
  // и индикатора «развёрнута не последняя версия»
  handle(
    "versions:external",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const external = project.external;
        if (!external) throw new Error(t("projectNotFound"));
        return withServer(getServer(project.serverId), args.password, (conn) =>
          getExternalVersions(conn, external.appDir, external.branch),
        );
      }),
  );
  // Light local-only sync check for the Status tab indicator: no network
  // fetch, so a slow git remote cannot delay the status snapshot
  handle(
    "versions:externalState",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const external = project.external;
        if (!external) throw new Error(t("projectNotFound"));
        return withServer(getServer(project.serverId), args.password, (conn) =>
          getExternalSyncState(conn, external.appDir),
        );
      }),
  );
  // Возврат версии внешнего проекта: повторный деплой выбранного коммита
  handle(
    "deploy:rollbackExternal",
    (_e, args) =>
      toResult(async () => {
        // Хеш попадает в shell-команду на сервере — только настоящие хеши
        if (!/^[0-9a-f]{7,40}$/i.test(args.commit)) {
          throw new Error(t("invalidCommit"));
        }
        return runExternalInPlace(args.projectId, args.password, args.commit);
      }),
  );
  // Явный перенос импортированного проекта под управление Plantar:
  // прежний takeover-деплой, запускается только после подтверждения в GUI
  handle(
    "projects:migrate",
    (_e, args) =>
      toResult(() => runDeploy(args.projectId, args.password, args.legacyPeerDeps, true)),
  );
  // HTTPS for an imported app in place: certbot edits the app's own nginx
  // config, so no migration is needed. Runs only after an explicit
  // confirmation in the GUI — careful mode never touches the server silently
  handle(
    "external:setupHttps",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        if (!project.external) throw new Error(t("externalOnlyAction"));
        const config = projectConfig(project);
        const domain = config.domain;
        if (!domain) throw new Error(t("httpsNeedsDomain"));
        const email = readSettings().letsEncryptEmail || undefined;
        await withServer(getServer(project.serverId), args.password, (conn) =>
          setupExternalHttps(conn, domain, () => {}, email),
        );
      }),
  );
  // A per-app access_log for an imported app in place: one additive line in
  // the app's own nginx config (backed up, verified, restored on failure), so
  // the Visits card works without migration. Explicit confirmed action only
  handle(
    "external:enableAccessLog",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const external = project.external;
        if (!external) throw new Error(t("externalOnlyAction"));
        const config = projectConfig(project);
        const confFile = external.nginxConfFile;
        const appPort = config.port;
        if (!confFile || !appPort) throw new Error(t("accessLogUnavailable"));
        const logPath = appAccessLogPath(config.name);
        await withServer(getServer(project.serverId), args.password, (conn) =>
          enableExternalAccessLog(conn, { confFile, appPort, logPath }),
        );
        // The Visits card reads the discovered path — record the new log there
        writeProjects(
          readProjects().map((p) =>
            p.id === project.id
              ? { ...p, external: { ...external, accessLogPath: logPath } }
              : p,
          ),
        );
        return { logPath };
      }),
  );
  // Идущие сейчас прогоны — начальное состояние индикаторов деплоя в сайдбаре
  handle("deploy:active", () => toResult(async () => activeDeployRuns()));
  // Состояние прогона деплоя для вкладки: из памяти, после перезапуска — с диска
  handle("deploy:state", (_e, projectId) =>
    toResult(async () => {
      const project = getProject(projectId);
      return deployRunState(projectId) ?? restoredDeployState(project);
    }),
  );
}
