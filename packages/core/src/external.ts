import { type SshConnection, shellQuote } from "@plantar/ssh";
import { listAppEnvFiles } from "./discover";
import { t } from "./messages";
import {
  run,
  verifySiteAvailable,
  waitForApp,
  waitForStableProcess,
} from "./process-checks";

/**
 * Бережный режим для импортированных приложений: Plantar обновляет их
 * прямо в исходной папке на сервере — так же, как это сделал бы админ
 * руками (git pull, установка зависимостей, сборка, pm2 restart под
 * прежним именем). nginx, порты и структура releases не трогаются,
 * скрытых побочных эффектов нет.
 */

/** Коммит из git-истории приложения на сервере */
export interface ServerCommit {
  hash: string;
  shortHash: string;
  subject: string;
  /** ISO-дата коммита */
  date: string;
  author: string;
}

/** Поля разделены \x1f, коммиты — \x1e: темы коммитов бывают с переводами строк */
const GIT_LOG_FORMAT = "%H%x1f%h%x1f%s%x1f%cI%x1f%an%x1e";

export function parseServerCommits(stdout: string): ServerCommit[] {
  return stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [hash, shortHash, subject, date, author] = record.split("\x1f");
      if (!hash || !shortHash) return [];
      return [
        {
          hash,
          shortHash,
          subject: subject ?? "",
          date: date ?? "",
          author: author ?? "",
        },
      ];
    });
}

/** Снимок git-версий приложения на сервере для вкладки «Версии» */
export interface ExternalVersions {
  /** false — папка приложения не является git-репозиторием, версий нет */
  hasGit: boolean;
  /** Последние коммиты ветки, новые сначала */
  commits: ServerCommit[];
  /** Развёрнутый сейчас коммит (HEAD рабочей папки) */
  head: string | null;
  /** Вершина ветки (после fetch, если он удался) */
  branchTip: string | null;
  /** Развёрнут не последний коммит ветки — например, после возврата версии */
  behindTip: boolean;
}

/** Ветка попадает в shell-команды — пропускаем только безопасные имена */
function safeBranch(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) return undefined;
  return branch;
}

const COMMITS_LIMIT = 30;

export async function getExternalVersions(
  conn: SshConnection,
  appDir: string,
  branch?: string,
): Promise<ExternalVersions> {
  const dir = shellQuote(appDir);
  const headResult = await conn.exec(`git -C ${dir} rev-parse --verify HEAD 2>/dev/null`);
  if (headResult.code !== 0) {
    return { hasGit: false, commits: [], head: null, branchTip: null, behindTip: false };
  }
  const head = headResult.stdout.trim() || null;

  // fetch может не пройти (нет сети или доступа) — тогда список строится
  // по локальной истории; это не ошибка
  await conn.exec(`git -C ${dir} fetch --quiet 2>/dev/null`);

  // Вершину ветки ищем сначала в remote-tracking ссылке: после fetch она
  // содержит коммиты, которых ещё нет в локальной ветке
  let branchTip: string | null = null;
  let logRef = "HEAD";
  const safe = safeBranch(branch);
  if (safe) {
    for (const ref of [`origin/${safe}`, safe]) {
      const tip = await conn.exec(
        `git -C ${dir} rev-parse --verify ${shellQuote(ref)} 2>/dev/null`,
      );
      if (tip.code === 0 && tip.stdout.trim()) {
        branchTip = tip.stdout.trim();
        logRef = ref;
        break;
      }
    }
  }

  const log = await conn.exec(
    `git -C ${dir} log ${shellQuote(logRef)} -n ${COMMITS_LIMIT} ` +
      `--format=${shellQuote(GIT_LOG_FORMAT)} 2>/dev/null`,
  );
  return {
    hasGit: true,
    commits: parseServerCommits(log.stdout),
    head,
    branchTip,
    behindTip: Boolean(head && branchTip && head !== branchTip),
  };
}

/** Импортированное приложение на сервере — куда и как деплоить на месте */
export interface ExternalTarget {
  /** Папка приложения на сервере */
  appDir: string;
  /** Имя pm2-процесса, под которым приложение работало до Plantar */
  pm2Name: string;
  /** Ветка, развёрнутая на сервере; после возврата версии деплой возвращает на неё */
  branch?: string;
  runtime: "node" | "python";
  /** Боты проверяются на стабильность процесса, приложения — ответом по порту */
  type: "static" | "node" | "next" | "bot";
  port?: number;
  /** Публичный адрес для смоук-проверки после перезапуска; нет — проверка пропускается */
  url?: string;
}

export interface ExternalDeployResult {
  /** Развёрнутый коммит; null — прочитать не удалось */
  commit: ServerCommit | null;
}

const LOCKFILES: Array<[file: string, manager: string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/** Менеджер пакетов по lockfile в папке приложения на сервере */
async function detectServerPackageManager(
  conn: SshConnection,
  appDir: string,
): Promise<string> {
  const list = await conn.exec(`ls -a ${shellQuote(appDir)} 2>/dev/null`);
  const files = new Set(list.stdout.split("\n").map((line) => line.trim()));
  for (const [file, manager] of LOCKFILES) {
    if (files.has(file)) return manager;
  }
  return "npm";
}

async function readServerPackageJson(
  conn: SshConnection,
  appDir: string,
): Promise<{ scripts?: Record<string, string> } | null> {
  const result = await conn.exec(`cat ${shellQuote(`${appDir}/package.json`)} 2>/dev/null`);
  try {
    return JSON.parse(result.stdout) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

/** git-команда с читаемой ошибкой; файлы пользователя не трогаются принудительно */
async function runGit(
  conn: SshConnection,
  command: string,
  log: (line: string) => void,
): Promise<void> {
  log(`$ ${command}`);
  const result = await conn.exec(command);
  if (result.code !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .slice(-3000);
    throw new Error(t("externalGitFailed", { output }));
  }
}

/**
 * Обновляет импортированное приложение на месте: код через git, зависимости,
 * сборка и перезапуск pm2 под прежним именем — строго после успешной сборки,
 * чтобы неудачная сборка не тронула работающий процесс. С checkout —
 * разворачивает выбранный коммит (возврат версии, HEAD отвязывается);
 * обычный деплой возвращает ветку и подтягивает её вершину.
 */
export async function deployExternalInPlace(
  conn: SshConnection,
  target: ExternalTarget,
  log: (line: string) => void = () => {},
  options: { checkout?: string } = {},
): Promise<ExternalDeployResult> {
  const dir = shellQuote(target.appDir);
  const exists = await conn.exec(`test -d ${dir}`);
  if (exists.code !== 0) {
    throw new Error(t("externalAppDirMissing", { dir: target.appDir }));
  }
  const git = await conn.exec(`git -C ${dir} rev-parse --verify HEAD 2>/dev/null`);
  if (git.code !== 0) throw new Error(t("externalNoGit"));

  if (options.checkout) {
    log(t("externalCheckingOut", { commit: options.checkout.slice(0, 7) }));
    await runGit(conn, `git -C ${dir} checkout --detach ${shellQuote(options.checkout)}`, log);
  } else {
    log(t("externalUpdatingRepo"));
    const branch = safeBranch(target.branch);
    // checkout ветки лечит отвязанный HEAD после возврата версии
    await runGit(
      conn,
      branch
        ? `git -C ${dir} checkout ${shellQuote(branch)} && git -C ${dir} pull --ff-only`
        : `git -C ${dir} pull --ff-only`,
      log,
    );
  }

  if (target.runtime === "python") {
    // Глобальную среду python не трогаем — обновляем зависимости только
    // в venv самого приложения, если он есть
    const venv = await conn.exec(
      `test -f ${shellQuote(`${target.appDir}/requirements.txt`)} && ` +
        `test -x ${shellQuote(`${target.appDir}/.venv/bin/pip`)}`,
    );
    if (venv.code === 0) {
      log(t("externalPipInstall"));
      await run(conn, `cd ${dir} && .venv/bin/pip install -r requirements.txt`, log);
    }
  } else {
    const packageManager = await detectServerPackageManager(conn, target.appDir);
    log(t("installingDeps", { packageManager }));
    await run(conn, `cd ${dir} && ${packageManager} install`, log);

    const pkg = await readServerPackageJson(conn, target.appDir);
    if (pkg?.scripts?.build) {
      const buildCommand = `${packageManager} run build`;
      log(t("building", { command: buildCommand }));
      // Рабочее приложение недолго живёт рядом с пересобираемой папкой —
      // так же, как при ручном деплое команды; перезапуск только после сборки
      await run(conn, `cd ${dir} && export NODE_ENV=production && ${buildCommand}`, log);
    }
  }

  log(t("externalRestarting", { name: target.pm2Name }));
  await run(conn, `pm2 restart ${shellQuote(target.pm2Name)} --update-env`, log);

  if (target.type === "bot" || !target.port) {
    await waitForStableProcess(conn, target.pm2Name, log);
  } else {
    await waitForApp(conn, target.pm2Name, target.port, log);
  }
  if (target.url) {
    await verifySiteAvailable(conn, target.url, "appAvailable", log);
  }
  log(options.checkout ? t("externalRollbackDone") : t("externalDeployDone"));

  const commit = await conn.exec(
    `git -C ${dir} log -1 --format=${shellQuote(GIT_LOG_FORMAT)} 2>/dev/null`,
  );
  return { commit: parseServerCommits(commit.stdout)[0] ?? null };
}

/**
 * Файл переменных внешнего приложения: базовый .env, при его отсутствии —
 * первый по порядку dotenv; нет ни одного — будет создан .env.
 * Остальные env-файлы не читаются и не перезаписываются.
 */
async function externalEnvFile(conn: SshConnection, appDir: string): Promise<string> {
  const files = await listAppEnvFiles(conn, appDir);
  return files[0] ?? ".env";
}

/** Переменные внешнего приложения — из .env в его папке; нет файла — пустая строка */
export async function readExternalEnv(
  conn: SshConnection,
  appDir: string,
): Promise<string> {
  const file = await externalEnvFile(conn, appDir);
  const result = await conn.exec(`cat ${shellQuote(`${appDir}/${file}`)} 2>/dev/null`);
  return result.code === 0 ? result.stdout : "";
}

/** Сохраняет переменные внешнего приложения в его .env; хранилище Plantar не используется */
export async function writeExternalEnv(
  conn: SshConnection,
  appDir: string,
  content: string,
): Promise<void> {
  const file = `${appDir}/${await externalEnvFile(conn, appDir)}`;
  // base64 избавляет от экранирования произвольных значений; 600 — файл с секретами
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const result = await conn.exec(
    `echo '${encoded}' | base64 -d > ${shellQuote(file)} && chmod 600 ${shellQuote(file)}`,
  );
  if (result.code !== 0) {
    throw new Error(t("envSaveFailed", { stderr: result.stderr.slice(-2000) }));
  }
}
