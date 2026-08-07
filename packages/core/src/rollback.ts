import type { SshConnection } from "@plantar/ssh";
import type { ProjectConfig } from "@plantar/config";
import { parsePm2Jlist } from "./discover";
import { t } from "./messages";
import { configureNginx } from "./nginx";
import {
  run,
  verifySiteAvailable,
  waitForApp,
  waitForStableProcess,
} from "./process-checks";
import type { SiteCheckStatus } from "./process-checks";
import { listReleases, releasesDir, switchCurrent } from "./releases";

/** Порт из pm2-конфига версии — на случай, если порт менялся между версиями */
export async function releasePort(
  conn: SshConnection,
  name: string,
  release: string,
): Promise<number | undefined> {
  const ecosystem = await conn.exec(
    `cat '${releasesDir(name)}/${release}/plantar.pm2.config.cjs' 2>/dev/null`,
  );
  const match = ecosystem.stdout.match(/"PORT":\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

/** Версия, из которой реально запущен pm2-процесс приложения; null — процесс
 *  не найден или работает не из папки releases (не под управлением Plantar) */
async function pm2RunningRelease(
  conn: SshConnection,
  name: string,
): Promise<string | null> {
  const jlist = await conn.exec("pm2 jlist 2>/dev/null");
  const proc = parsePm2Jlist(jlist.stdout).find((p) => p.name === name);
  const match = proc?.cwd.match(/\/releases\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/**
 * Версия, к которой ведёт возврат. Обычно — предыдущая относительно current,
 * но после неудачного деплоя процесс работает (или падает) не из current:
 * тогда возвращаем сам current — последнюю рабочую версию. null — некуда.
 */
export function pickRollbackTarget(
  releases: string[],
  current: string,
  /** Версия, из которой реально запущен процесс; null — процесс не найден */
  running: string | null,
): string | null {
  if (running !== current) return current;
  return releases[releases.indexOf(current) + 1] ?? null;
}

/** Пересоздаёт pm2-процесс из конфига сохранённой версии: pm2 restart не всегда
 *  применяет новые cwd/script, поэтому старый процесс удаляется и стартует новый;
 *  pm2 flush — чтобы в отчёты об ошибках не попадали логи прошлых версий */
export async function restartFromEcosystem(
  conn: SshConnection,
  name: string,
  ecosystemPath: string,
  log: (line: string) => void,
): Promise<void> {
  await run(
    conn,
    `pm2 delete '${name}' >/dev/null 2>&1; pm2 flush '${name}' >/dev/null 2>&1; pm2 start '${ecosystemPath}'`,
    log,
  );
  await run(conn, "pm2 save", log);
}

/**
 * Возвращает прежнюю версию в pm2 после неудачного запуска новой.
 * Ошибок не бросает: наружу должна уйти исходная ошибка деплоя,
 * а итог восстановления виден в деплой-логе.
 */
export async function restorePreviousRelease(
  conn: SshConnection,
  config: ProjectConfig,
  release: string,
  log: (line: string) => void,
): Promise<void> {
  try {
    const ecosystemPath = `${releasesDir(config.name)}/${release}/plantar.pm2.config.cjs`;
    const exists = await conn.exec(`test -f '${ecosystemPath}'`);
    if (exists.code !== 0) {
      log(t("restoreNoEcosystem", { release }));
      return;
    }
    log(t("restoringPrevious", { release }));
    await restartFromEcosystem(conn, config.name, ecosystemPath, log);
    if (config.type === "bot") {
      await waitForStableProcess(conn, config.name, log);
    } else {
      const port = (await releasePort(conn, config.name, release)) ?? config.port;
      if (port) await waitForApp(conn, config.name, port, log);
    }
    log(t("previousRestored", { release }));
  } catch (err) {
    log(t("restorePreviousFailed", { error: (err as Error).message }));
  }
}

export interface RollbackResult {
  /** Версия, к которой вернулись */
  release: string;
  /** Адрес сайта; у ботов его нет */
  url?: string;
  /** How the address answered the availability check after the rollback;
   *  undefined when there was no address to check */
  urlCheck?: SiteCheckStatus;
}

/**
 * Возвращает предыдущую версию: у сайтов переключает симлинк current,
 * у приложений перезапускает pm2 из папки предыдущей версии.
 * Если после неудачного деплоя запущенная в pm2 версия разошлась
 * с current, возвращает сам current — последнюю рабочую версию.
 * Работает только с управляемой структурой releases/current.
 */
export async function rollbackProject(
  conn: SshConnection,
  config: ProjectConfig,
  log: (line: string) => void = () => {},
): Promise<RollbackResult> {
  const { releases, current } = await listReleases(conn, config.name);
  if (!current) throw new Error(t("rollbackNotManaged"));
  // Статику pm2 не запускает — расходиться нечему; у приложений смотрим на реальный процесс
  const running =
    config.type === "static" ? current : await pm2RunningRelease(conn, config.name);
  const previous = pickRollbackTarget(releases, current, running);
  if (!previous) throw new Error(t("rollbackNoPrevious"));

  log(
    previous === current
      ? t("rollbackToWorking", { release: previous })
      : t("rollbackStarting", { release: previous }),
  );

  if (config.type !== "static") {
    const ecosystemPath = `${releasesDir(config.name)}/${previous}/plantar.pm2.config.cjs`;
    const exists = await conn.exec(`test -f '${ecosystemPath}'`);
    if (exists.code !== 0) throw new Error(t("rollbackNoEcosystem", { release: previous }));

    await restartFromEcosystem(conn, config.name, ecosystemPath, log);

    if (config.type === "bot") {
      await waitForStableProcess(conn, config.name, log);
    } else {
      const port = (await releasePort(conn, config.name, previous)) ?? config.port;
      if (port) {
        await waitForApp(conn, config.name, port, log);
        // У предыдущей версии мог быть другой порт — направляем nginx на него
        if (port !== config.port) await configureNginx(conn, config, log, port);
      }
    }
  }

  await switchCurrent(conn, config.name, previous, log);
  log(t("rollbackDone", { release: previous }));

  // Bots have no address to check — the stable pm2 process above is the result
  if (config.type === "bot") return { release: previous };
  const url = config.domain ? `https://${config.domain}/` : `http://${conn.host}/`;
  // The same non-throwing smoke check deploys run: a restored version that
  // stayed silent must not be presented as a working link
  const urlCheck = await verifySiteAvailable(
    conn,
    url,
    config.type === "static" ? "siteAvailable" : "appAvailable",
    log,
  );
  return { release: previous, url, urlCheck };
}
