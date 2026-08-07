import { Notification } from "electron";
import { type ProjectConfig, loadProjectConfig, writeProjectConfig } from "@plantar/config";
import {
  type SiteCheckStatus,
  deployExternalInPlace,
  deployProject,
  readAppEnv,
  readProjectEnv,
  rollbackProject,
  writeProjectEnv,
} from "@plantar/core";
import {
  DeployLogWriter,
  type ProjectRecord,
  type ServerRecord,
  readProjects,
  readSettings,
  writeProjects,
} from "@plantar/storage";
import { withServer } from "./connections";
import { deployNotificationText } from "./deploy-notification";
import { startDeployRun } from "./deploy-runs";
import { headCommit, updateRepo } from "./git";
import { getToken } from "./github";
import { t } from "./i18n";
import { getProject, getServer, projectConfig, projectDir } from "./records";
import { type RunOutcome, finishRun } from "./run-finish";
import { openFromBackground } from "./window";

/** Системное уведомление о результате деплоя; клик открывает окно на проекте */
function notifyDeployResult(
  projectId: string,
  projectName: string,
  success: boolean,
  urlCheck?: SiteCheckStatus,
): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification(
    deployNotificationText(projectName, success, urlCheck),
  );
  notification.on("click", () => openFromBackground(projectId));
  notification.show();
}

export async function runDeploy(
  projectId: string,
  password: string | undefined,
  // Режим совместимости (npm --legacy-peer-deps); пользователь подтвердил кнопкой в GUI
  legacyPeerDeps?: boolean,
  // Перенос импортированного проекта под управление Plantar — прежний
  // takeover-деплой, но только как явное действие с подтверждением в GUI
  migrate = false,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  // Импортированный проект живёт в бережном режиме: обновляется в своей
  // папке на сервере, без переноса под структуру Plantar
  if (project.external && !migrate) return runExternalInPlace(projectId, password);
  // Перенос под управление Plantar возможен только после привязки папки с кодом
  if (project.external && !project.path) throw new Error(t("externalNeedsFolder"));
  return runManagedDeploy(project, password, legacyPeerDeps, migrate);
}

/** Git source: brings the clone to the fresh tip of the branch before the
 *  deploy; returns the restored config and the commit being deployed */
async function updateGitClone(
  project: ProjectRecord,
  dir: string,
  config: ProjectConfig,
  log: (line: string) => void,
): Promise<{ config: ProjectConfig; commit?: { hash: string; message: string } }> {
  log(t("deployUpdatingRepo"));
  await updateRepo(project.path, project.branch!, getToken() ?? undefined);
  // plantar.json лежит untracked и переживает reset; на всякий случай восстанавливаем конфиг
  const restored = writeProjectConfig(dir, config);
  // Коммит фиксируем до сборки — он нужен и в успешной, и в упавшей записи истории
  try {
    return { config: restored, commit: await headCommit(project.path) };
  } catch {
    /* не смогли прочитать коммит — деплой всё равно продолжаем */
    return { config: restored };
  }
}

/** При переносе под управление Plantar переменные из .env приложения
 *  переезжают в хранилище Plantar — деплой подставит их как раньше */
async function migrateAppEnv(
  server: ServerRecord,
  password: string | undefined,
  name: string,
  appDir: string,
): Promise<void> {
  await withServer(server, password, async (conn) => {
    if (!(await readProjectEnv(conn, name))) {
      const env = await readAppEnv(conn, appDir);
      if (env) await writeProjectEnv(conn, name, env);
    }
  });
}

/** Перенос под управление Plantar снимает прежний процесс и конфиг nginx */
function takeoverTarget(
  project: ProjectRecord,
  migrate: boolean,
): { pm2Name: string; nginxConfFile?: string } | undefined {
  return migrate && project.external
    ? {
        pm2Name: project.external.pm2Name,
        nginxConfFile: project.external.nginxConfFile,
      }
    : undefined;
}

/** The managed deploy shared by the regular, git and migrate modes;
 *  the mode routing itself lives in runDeploy */
async function runManagedDeploy(
  project: ProjectRecord,
  password: string | undefined,
  legacyPeerDeps: boolean | undefined,
  migrate: boolean,
): Promise<{ url?: string }> {
  const server = getServer(project.serverId);
  const dir = projectDir(project);
  let config = loadProjectConfig(dir);

  // Прогон регистрируется до первого await — второй одновременный деплой
  // одного проекта отсекается здесь же, не оставляя пустого файла лога
  // The migrate kind survives in the run state and history: after a failed
  // migrate the old pm2 process is deleted, so the "return to previous
  // version" recovery must not be offered for this run
  const kind = migrate ? ("migrate" as const) : ("deploy" as const);
  const run = startDeployRun(project.id, kind);
  const startedAt = new Date().toISOString();

  // git-проект: обновляем клон до свежего коммита ветки перед деплоем
  let deployedCommit: { hash: string; message: string } | undefined;
  let logWriter: DeployLogWriter | undefined;
  // Built at call time: logWriter appears inside try, config may be reloaded
  const finish = (outcome: RunOutcome): void =>
    finishRun(
      {
        run,
        logWriter,
        project: config.name,
        projectId: project.id,
        host: server.host,
        startedAt,
        kind: migrate ? kind : undefined,
        notify: (success, urlCheck) =>
          notifyDeployResult(project.id, config.name, success, urlCheck),
      },
      outcome,
    );
  try {
    logWriter = new DeployLogWriter(config.name);
    const writer = logWriter;
    const log = (line: string) => {
      writer.write(line);
      run.log(line);
    };
    if (project.source === "git") {
      const updated = await updateGitClone(project, dir, config, log);
      config = updated.config;
      deployedCommit = updated.commit;
    }

    const settings = readSettings();
    // Флаг не пишем в конфиг заранее: он закрепится ниже, только если деплой удался
    const deployConfig = legacyPeerDeps ? { ...config, legacyPeerDeps: true } : config;
    if (migrate && project.external) {
      await migrateAppEnv(server, password, config.name, project.external.appDir);
    }
    const result = await withServer(server, password, (conn) =>
      deployProject(conn, dir, deployConfig, log, {
        letsEncryptEmail: settings.letsEncryptEmail || undefined,
        takeover: takeoverTarget(project, migrate),
      }),
    );
    // Закрепляем в конфиге порт (выбирается на сервере при первом деплое)
    // и режим совместимости — подтверждённый выбор нужен и автодеплою из CI
    const configUpdates: Partial<ProjectConfig> = {};
    if (result.port && result.port !== config.port) configUpdates.port = result.port;
    if (legacyPeerDeps && !config.legacyPeerDeps) configUpdates.legacyPeerDeps = true;
    if (Object.keys(configUpdates).length > 0) {
      writeProjectConfig(dir, { ...config, ...configUpdates });
    }
    // git-проект: запоминаем задеплоенный коммит для карточки проекта и вкладки «Коммиты»
    // После переноса под управление Plantar пометка «внешний» снимается —
    // дальше проект живёт как обычный (структура releases, мгновенный возврат)
    if (deployedCommit || project.external) {
      const commit = deployedCommit;
      writeProjects(
        readProjects().map((p) =>
          p.id === project.id
            ? { ...p, ...(commit ? { deployedCommit: commit } : {}), external: undefined }
            : p,
        ),
      );
    }
    finish({
      status: "success",
      url: result.url,
      urlCheck: result.urlCheck,
      commit: deployedCommit?.hash,
    });
    return { url: result.url };
  } catch (err) {
    finish({ status: "error", err, commit: deployedCommit?.hash });
    throw err;
  }
}

/**
 * Бережный деплой импортированного проекта: код обновляется в исходной папке
 * приложения на сервере (git), процесс перезапускается под прежним именем pm2.
 * nginx, порты и структура releases не меняются. С checkoutCommit —
 * возврат версии: разворачивается указанный коммит вместо вершины ветки.
 */
export async function runExternalInPlace(
  projectId: string,
  password: string | undefined,
  checkoutCommit?: string,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  const server = getServer(project.serverId);
  const external = project.external;
  if (!external) throw new Error(t("projectNotFound"));
  const config = projectConfig(project);

  const run = startDeployRun(projectId, checkoutCommit ? "rollback" : "deploy");
  const startedAt = new Date().toISOString();
  const kind = checkoutCommit ? ("rollback" as const) : ("deploy" as const);

  let logWriter: DeployLogWriter | undefined;
  // Built at call time: logWriter appears inside try
  const finish = (outcome: RunOutcome): void =>
    finishRun(
      {
        run,
        logWriter,
        project: config.name,
        projectId: project.id,
        host: server.host,
        startedAt,
        kind,
        notify: (success, urlCheck) =>
          notifyDeployResult(projectId, config.name, success, urlCheck),
      },
      outcome,
    );
  try {
    logWriter = new DeployLogWriter(config.name);
    const writer = logWriter;
    const log = (line: string) => {
      writer.write(line);
      run.log(line);
    };
    // Смоук-проверка только по известному домену: своего nginx-конфига
    // у бережного режима нет, адрес по IP приложению может не принадлежать
    const url =
      config.type !== "bot" && config.domain ? `https://${config.domain}/` : undefined;
    const result = await withServer(server, password, (conn) =>
      deployExternalInPlace(
        conn,
        {
          appDir: external.appDir,
          pm2Name: external.pm2Name,
          branch: external.branch,
          runtime: config.runtime,
          type: config.type,
          port: config.port,
          url,
        },
        log,
        checkoutCommit ? { checkout: checkoutCommit } : {},
      ),
    );
    // Развёрнутый коммит — для строки версии на вкладке «Деплой» и кнопки
    // «вернуть предыдущую версию» после неудачного деплоя
    if (result.commit) {
      const commit = { hash: result.commit.hash, message: result.commit.subject };
      writeProjects(
        readProjects().map((p) =>
          p.id === project.id ? { ...p, deployedCommit: commit } : p,
        ),
      );
    }
    finish({
      status: "success",
      url,
      urlCheck: result.urlCheck,
      commit: result.commit?.hash,
    });
    return { url };
  } catch (err) {
    finish({ status: "error", err });
    throw err;
  }
}

/** Возврат предыдущей версии; лог идёт в тот же канал, что и лог деплоя */
export async function runRollback(
  projectId: string,
  password: string | undefined,
): Promise<{ url?: string }> {
  const project = getProject(projectId);
  // У внешних проектов нет структуры releases — их возврат версии идёт
  // по git-истории через deploy:rollbackExternal
  if (project.external) throw new Error(t("rollbackUnavailableExternal"));
  const server = getServer(project.serverId);
  const config = projectConfig(project);

  const run = startDeployRun(projectId, "rollback");
  const startedAt = new Date().toISOString();

  let logWriter: DeployLogWriter | undefined;
  // Built at call time: logWriter appears inside try
  const finish = (outcome: RunOutcome): void =>
    finishRun(
      {
        run,
        logWriter,
        project: config.name,
        projectId: project.id,
        host: server.host,
        startedAt,
        kind: "rollback",
        notify: (success, urlCheck) =>
          notifyDeployResult(projectId, config.name, success, urlCheck),
      },
      outcome,
    );
  try {
    logWriter = new DeployLogWriter(config.name);
    const writer = logWriter;
    const log = (line: string) => {
      writer.write(line);
      run.log(line);
    };
    const result = await withServer(server, password, (conn) =>
      rollbackProject(conn, config, log),
    );
    finish({ status: "success", url: result.url, urlCheck: result.urlCheck });
    return { url: result.url };
  } catch (err) {
    finish({ status: "error", err });
    throw err;
  }
}
