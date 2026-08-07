import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import { type SshConnection, shellQuote } from "@plantar/ssh";
import { readPackageJson, type ProjectConfig } from "@plantar/config";
import { ENV_FILE_RE } from "./discover";
import { envStorePath, parseEnv, readProjectEnv } from "./env-store";
import { t } from "./messages";
import { configureNginx, disableForeignNginxConf, setupSsl } from "./nginx";
import { run, verifySiteAvailable, waitForApp, waitForStableProcess } from "./process-checks";
import type { SiteCheckStatus } from "./process-checks";
import {
  finalizeRelease,
  listReleases,
  newReleaseName,
  pruneReleases,
  switchCurrent,
} from "./releases";
import { restorePreviousRelease } from "./rollback";

/**
 * npm не смог согласовать peer-зависимости (ERESOLVE). GUI по коду ошибки
 * предлагает повторить деплой в режиме совместимости (--legacy-peer-deps).
 */
export class NpmPeerConflictError extends Error {
  code = "npm-peer-conflict" as const;
}

/** Команда установки зависимостей с учётом режима совместимости (только npm) */
function installCommandFor(config: ProjectConfig): string {
  return config.packageManager === "npm" && config.legacyPeerDeps
    ? "npm install --legacy-peer-deps"
    : `${config.packageManager} install`;
}

function logInstallingDeps(config: ProjectConfig, log: (line: string) => void): void {
  log(
    config.packageManager === "npm" && config.legacyPeerDeps
      ? t("installingDepsCompat")
      : t("installingDeps", { packageManager: config.packageManager }),
  );
}

/** Конфликт peer-зависимостей: строгий npm упал на ERESOLVE, режим совместимости не включён */
function isPeerConflict(config: ProjectConfig, output: string): boolean {
  return (
    config.packageManager === "npm" &&
    !config.legacyPeerDeps &&
    output.includes("ERESOLVE")
  );
}

export interface DeployResult {
  target: string;
  fileCount: number;
  /** Адрес сайта; у ботов его нет */
  url?: string;
  /** How the address answered the availability check; undefined when there
   *  was no address to check */
  urlCheck?: SiteCheckStatus;
  /** Порт Node.js-приложения; статические сайты и боты его не используют */
  port?: number;
}

export interface DeployOptions {
  /** Email для регистрации в Let's Encrypt */
  letsEncryptEmail?: string;
  /** Явный перенос импортированного проекта под управление Plantar: перед
   *  запуском снимается прежний pm2-процесс, а прежний конфиг nginx
   *  отключается — дальше приложение живёт в структуре Plantar */
  takeover?: {
    pm2Name: string;
    nginxConfFile?: string;
  };
}

/** Останавливает pm2-процесс, под которым приложение работало до импорта */
async function takeoverPm2(
  conn: SshConnection,
  pm2Name: string,
  log: (line: string) => void,
): Promise<void> {
  log(t("takeoverStoppingOld", { name: pm2Name }));
  const deleted = await conn.exec(`pm2 delete ${shellQuote(pm2Name)}`);
  if (deleted.code === 0) log(t("takeoverOldStopped"));
  else log(t("pm2NotFound"));
}

/** Бэкенды со скриптом build (Strapi, NestJS, TypeScript) стартуют из собранного кода */
function hasBuildScript(projectDir: string): boolean {
  return Boolean(readPackageJson(projectDir)?.scripts?.build);
}

export async function deployProject(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void = () => {},
  options: DeployOptions = {},
): Promise<DeployResult> {
  switch (config.type) {
    case "node":
      return deployNode(conn, projectDir, config, log, options, hasBuildScript(projectDir));
    case "next":
      return deployNode(conn, projectDir, config, log, options, true);
    case "bot":
      return deployBot(conn, projectDir, config, log, options);
    default:
      return deployStatic(conn, projectDir, config, log, options);
  }
}

async function deployStatic(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions,
): Promise<DeployResult> {
  // Переменные проекта хранятся на сервере; при сборке они приоритетнее локальных .env
  const envVars = parseEnv(await readProjectEnv(conn, config.name));
  const varCount = Object.keys(envVars).length;
  if (varCount > 0) log(t("serverEnvVars", { count: varCount }));

  // Свежесклонированный репозиторий не содержит node_modules — ставим зависимости
  // локально. Без серверных env: там часто NODE_ENV=production, из-за которого
  // yarn/npm пропустят devDependencies (vite, typescript), и сборка упадёт.
  if (!existsSync(path.join(projectDir, "node_modules"))) {
    const installCommand = installCommandFor(config);
    logInstallingDeps(config, log);
    try {
      await execAsync(installCommand, { cwd: projectDir, maxBuffer: 50 * 1024 * 1024 });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      const output = [e.stdout, e.stderr].filter(Boolean).join("\n").slice(-3000);
      if (isPeerConflict(config, output)) {
        throw new NpmPeerConflictError(t("npmPeerConflict", { output }));
      }
      throw new Error(t("installLocalFailed", { command: installCommand, output }));
    }
  }

  log(t("building", { command: config.buildCommand }));
  try {
    // Plantar в dev-режиме сам работает с NODE_ENV=development. Не передаём это
    // значение в production-сборку проекта: Next.js и Vite выставят нужный режим сами.
    const buildEnv = { ...process.env, ...envVars };
    delete buildEnv.NODE_ENV;
    await execAsync(config.buildCommand, {
      cwd: projectDir,
      maxBuffer: 50 * 1024 * 1024,
      env: buildEnv,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const output = [e.stdout, e.stderr]
      .filter(Boolean)
      .join("\n")
      .slice(-3000);
    throw new Error(t("buildFailed", { command: config.buildCommand, output }));
  }

  const localDist = path.join(projectDir, config.buildDir);
  if (!existsSync(localDist)) {
    throw new Error(t("buildDirMissing", { dir: config.buildDir, projectDir }));
  }

  const staging = `/var/www/.${config.name}.uploading`;

  await run(conn, `rm -rf '${staging}'`, log);
  log(t("uploadingFiles"));
  const fileCount = await conn.uploadDirectory(
    localDist,
    staging,
    (file) => log(`  ↑ ${file}`),
    [],
    log,
  );
  const release = newReleaseName();
  const target = await finalizeRelease(conn, config.name, staging, release, log);
  await switchCurrent(conn, config.name, release, log);
  await pruneReleases(conn, config.name, log);
  log(t("deployedFiles", { count: fileCount, target }));

  if (options.takeover?.nginxConfFile) {
    await disableForeignNginxConf(conn, options.takeover.nginxConfFile, config.name, log);
  }
  await configureNginx(conn, config, log);

  let url: string;
  if (config.domain) {
    await setupSsl(conn, config.domain, log, options.letsEncryptEmail);
    url = `https://${config.domain}/`;
  } else {
    url = `http://${conn.host}/`;
  }
  const urlCheck = await verifySiteAvailable(conn, url, "siteAvailable", log);
  return { target, fileCount, url, urlCheck };
}

const APP_PORT_RANGE = { from: 3001, to: 3999 };

/** Свободный порт: не занят слушающим процессом и не выдан другому сайту в nginx */
// Exported for unit tests only — deploys go through deployProject
export async function pickFreePort(conn: SshConnection): Promise<number> {
  const used = new Set<number>();

  const listening = await conn.exec("ss -tlnH");
  for (const match of listening.stdout.matchAll(/:(\d+)\s/g)) {
    used.add(Number(match[1]));
  }

  // Порты упавших приложений не слушаются, но закреплены в конфигах nginx
  const assigned = await conn.exec(
    "grep -rhoE 'proxy_pass http://127\\.0\\.0\\.1:[0-9]+' /etc/nginx/sites-available/ 2>/dev/null",
  );
  for (const match of assigned.stdout.matchAll(/:(\d+)/g)) {
    used.add(Number(match[1]));
  }

  for (let port = APP_PORT_RANGE.from; port <= APP_PORT_RANGE.to; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error(
    t("noFreePort", { from: APP_PORT_RANGE.from, to: APP_PORT_RANGE.to }),
  );
}

/** Общее для node, Next.js и bot: загрузка проекта, зависимости, сборка и подмена папки */
async function uploadApp(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  buildOnServer = false,
): Promise<{ target: string; fileCount: number; release: string }> {
  const python = config.runtime === "python";
  if (python && !existsSync(path.join(projectDir, "requirements.txt"))) {
    throw new Error(t("requirementsMissing", { dir: projectDir }));
  }

  const staging = `/var/www/.${config.name}.uploading`;

  await run(conn, `rm -rf '${staging}'`, log);
  log(t("uploadingFiles"));
  // Локальные .env-файлы не загружаются: переменные проекта хранятся на сервере
  const fileCount = await conn.uploadDirectory(
    projectDir,
    staging,
    (file) => log(`  ↑ ${file}`),
    python
      ? [".venv", "__pycache__", ".git", ENV_FILE_RE]
      : ["node_modules", ...(buildOnServer ? [".next"] : []), ".git", ENV_FILE_RE],
    log,
  );
  log(t("uploadedFiles", { count: fileCount }));

  if (python) {
    log(t("installingPythonDeps"));
    await run(
      conn,
      `cd '${staging}' && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`,
      log,
    );
  } else {
    logInstallingDeps(config, log);
    const installCommand = `cd '${staging}' && ${installCommandFor(config)}`;
    log(`$ ${installCommand}`);
    const installed = await conn.exec(installCommand);
    if (installed.code !== 0) {
      const output = [installed.stdout, installed.stderr]
        .filter(Boolean)
        .join("\n")
        .slice(-3000);
      if (isPeerConflict(config, output)) {
        throw new NpmPeerConflictError(t("npmPeerConflict", { output }));
      }
      throw new Error(
        t("commandFailed", { code: installed.code, command: installCommand, stderr: output }),
      );
    }
  }

  // Env-файл проекта хранится вне папки релиза — кладём копию рядом с кодом,
  // чтобы приложение нашло его как обычный .env. Для Next.js это делается
  // до сборки: NEXT_PUBLIC_* и серверные переменные могут понадобиться в build.
  const envFile = envStorePath(config.name);
  const hasEnv = await conn.exec(`test -f '${envFile}'`);
  if (hasEnv.code === 0) {
    log(t("applyingServerEnv"));
    await run(conn, `cp '${envFile}' '${staging}/.env' && chmod 600 '${staging}/.env'`, log);
  }

  if (buildOnServer) {
    log(t("building", { command: config.buildCommand }));
    // SSH-сессия или сохранённый .env не должны подменить production-режим сборки.
    await run(
      conn,
      `cd '${staging}' && export NODE_ENV=production && ${config.buildCommand}`,
      log,
    );
  }

  const release = newReleaseName();
  const target = await finalizeRelease(conn, config.name, staging, release, log);
  log(t("deployedFiles", { count: fileCount, target }));
  return { target, fileCount, release };
}

/** Пишет pm2-конфиг и запускает процесс; настраивает автозапуск после перезагрузки сервера */
async function startWithPm2(
  conn: SshConnection,
  target: string,
  config: ProjectConfig,
  env: Record<string, string | number>,
  log: (line: string) => void,
): Promise<void> {
  const python = config.runtime === "python";
  // pm2 запускает первый токен команды как исполняемый файл; интерпретатор
  // ("node app.js", "python bot.py") отрезаем — pm2 подставит свой
  const startCommand =
    config.startCommand ?? (python ? "" : `${config.packageManager} start`);
  const tokens = startCommand.trim().split(/\s+/);
  if (["node", "python", "python3"].includes(tokens[0])) tokens.shift();
  const [script, ...scriptArgs] = tokens;
  if (!script) throw new Error(t("emptyStartCommand"));

  // Python-процесс запускается интерпретатором из venv, созданного при деплое
  const interpreterLine = python
    ? `\n      interpreter: ${JSON.stringify(`${target}/.venv/bin/python`)},`
    : "";
  const ecosystemPath = `${target}/plantar.pm2.config.cjs`;
  const ecosystem = `module.exports = {
  apps: [
    {
      name: ${JSON.stringify(config.name)},
      cwd: ${JSON.stringify(target)},
      script: ${JSON.stringify(script)},
      args: ${JSON.stringify(scriptArgs.join(" "))},${interpreterLine}
      env: ${JSON.stringify(env)},
    },
  ],
};`;
  await run(conn, `cat > '${ecosystemPath}' <<'PLANTAR_EOF'\n${ecosystem}\nPLANTAR_EOF`, log);

  log(t("startingPm2", { command: startCommand }));
  // Каждая версия живёт в своей папке (releases/<метка>), а pm2 restart не всегда
  // применяет новые cwd/script из конфига — процесс пересоздаётся заново.
  // pm2 flush — иначе в отчёт об ошибке попадают строки логов прошлых релизов
  await run(
    conn,
    `pm2 delete '${config.name}' >/dev/null 2>&1; pm2 flush '${config.name}' >/dev/null 2>&1; pm2 start '${ecosystemPath}'`,
    log,
  );
  // pm2 startup + save: процесс переживёт перезагрузку сервера
  await run(conn, `pm2 startup systemd -u "$(whoami)" --hp "$HOME"`, log);
  await run(conn, "pm2 save", log);
}

async function deployNode(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions,
  buildOnServer = false,
): Promise<DeployResult> {
  const { target, fileCount, release } = await uploadApp(
    conn,
    projectDir,
    config,
    log,
    buildOnServer,
  );

  const port = config.port ?? (await pickFreePort(conn));
  if (port !== config.port) log(t("portAssigned", { port }));

  // Прежний процесс импортированного приложения держит порт — снимаем его до запуска
  if (options.takeover && options.takeover.pm2Name !== config.name) {
    await takeoverPm2(conn, options.takeover.pm2Name, log);
  }

  // Рабочая версия на этот момент: если новая не запустится, вернём её.
  // При первом деплое (в т.ч. импортированного приложения) current ещё нет —
  // восстанавливать нечего, чужой процесс не трогаем.
  const previousRelease = (await listReleases(conn, config.name)).current;

  try {
    await startWithPm2(conn, target, config, { PORT: port, NODE_ENV: "production" }, log);
    await waitForApp(conn, config.name, port, log);
  } catch (err) {
    if (previousRelease && previousRelease !== release) {
      await restorePreviousRelease(conn, config, previousRelease, log);
    }
    throw err;
  }

  await switchCurrent(conn, config.name, release, log);
  await pruneReleases(conn, config.name, log);

  if (options.takeover?.nginxConfFile) {
    await disableForeignNginxConf(conn, options.takeover.nginxConfFile, config.name, log);
  }
  await configureNginx(conn, config, log, port);

  let url: string;
  if (config.domain) {
    await setupSsl(conn, config.domain, log, options.letsEncryptEmail);
    url = `https://${config.domain}/`;
  } else {
    url = `http://${conn.host}/`;
  }
  const urlCheck = await verifySiteAvailable(conn, url, "appAvailable", log);
  return { target, fileCount, url, urlCheck, port };
}

async function deployBot(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions = {},
): Promise<DeployResult> {
  const { target, fileCount, release } = await uploadApp(conn, projectDir, config, log);

  // Прежний процесс импортированного бота продолжил бы работать параллельно
  if (options.takeover && options.takeover.pm2Name !== config.name) {
    await takeoverPm2(conn, options.takeover.pm2Name, log);
  }

  // Рабочая версия на этот момент — вернём её, если новая не запустится
  const previousRelease = (await listReleases(conn, config.name)).current;

  try {
    await startWithPm2(conn, target, config, { NODE_ENV: "production" }, log);
    await waitForStableProcess(conn, config.name, log);
  } catch (err) {
    if (previousRelease && previousRelease !== release) {
      await restorePreviousRelease(conn, config, previousRelease, log);
    }
    throw err;
  }

  await switchCurrent(conn, config.name, release, log);
  await pruneReleases(conn, config.name, log);

  log(t("botDeployed"));
  return { target, fileCount };
}
