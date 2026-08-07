import type { SshConnection } from "@plantar/ssh";
import { run } from "./process-checks";

/**
 * Управляемая структура на сервере: каждая версия деплоится в
 * /var/www/<name>/releases/<метка времени>, симлинк current указывает
 * на рабочую версию. Возврат предыдущей версии — переключение симлинка.
 */
export const appBaseDir = (name: string) => `/var/www/${name}`;
export const releasesDir = (name: string) => `${appBaseDir(name)}/releases`;
const KEEP_RELEASES = 5;

/** Имя новой версии; сортируется по алфавиту как по времени */
export function newReleaseName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Переносит staging-папку в releases/<release>. Старую плоскую структуру
 * (/var/www/<name> без releases) заменяет управляемой — прежняя копия
 * и так перетиралась при каждом деплое.
 */
export async function finalizeRelease(
  conn: SshConnection,
  name: string,
  staging: string,
  release: string,
  log: (line: string) => void,
): Promise<string> {
  const base = appBaseDir(name);
  const target = `${releasesDir(name)}/${release}`;
  await run(
    conn,
    `if [ -e '${base}' ] && [ ! -d '${base}/releases' ]; then rm -rf '${base}'; fi && ` +
      `mkdir -p '${releasesDir(name)}' && rm -rf '${target}' && mv '${staging}' '${target}'`,
    log,
  );
  return target;
}

/** Переключает current на версию; nginx и возврат версии смотрят на этот симлинк */
export async function switchCurrent(
  conn: SshConnection,
  name: string,
  release: string,
  log: (line: string) => void,
): Promise<void> {
  await run(conn, `ln -sfn 'releases/${release}' '${appBaseDir(name)}/current'`, log);
}

/** Удаляет старые версии, оставляя KEEP_RELEASES последних (current всегда среди них) */
export async function pruneReleases(
  conn: SshConnection,
  name: string,
  log: (line: string) => void,
): Promise<void> {
  await run(
    conn,
    `cd '${releasesDir(name)}' && ls -1 | sort | head -n -${KEEP_RELEASES} | xargs -r rm -rf --`,
    log,
  );
}

export interface ReleasesInfo {
  /** Имена версий, новые сначала */
  releases: string[];
  /** Версия, на которую указывает current; null — управляемой структуры ещё нет */
  current: string | null;
}

export async function listReleases(
  conn: SshConnection,
  name: string,
): Promise<ReleasesInfo> {
  const list = await conn.exec(`ls -1 '${releasesDir(name)}' 2>/dev/null | sort -r`);
  const releases = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const link = await conn.exec(`readlink '${appBaseDir(name)}/current' 2>/dev/null`);
  const current = link.stdout.trim().split("/").pop() ?? "";
  return { releases, current: releases.includes(current) ? current : null };
}
