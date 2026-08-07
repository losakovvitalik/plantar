import type { SshConnection } from "@plantar/ssh";
import { parsePm2Jlist } from "./discover";
import { envStorePath } from "./env-store";
import { t } from "./messages";
import { MAX_ERROR_STDERR_CHARS } from "./output-limits";
import { run } from "./process-checks";

/** Marker printed by the dump probe when the pm2 dump file does not exist */
const NO_DUMP_MARKER = "PLANTAR_NO_DUMP";

/**
 * Checks whether the pm2 startup dump (`$PM2_HOME/dump.pm2`) still lists the
 * process. A clean empty `pm2 jlist` table is not proof that the process is
 * gone: an earlier probe (status polling, an old removal attempt, a manual
 * `pm2 jlist` over SSH) may have respawned a dead daemon with an empty table
 * while the stale dump still holds the process — after a server reboot pm2
 * would resurrect it from the deleted directory.
 */
async function pm2DumpHoldsProcess(conn: SshConnection, name: string): Promise<boolean> {
  // PM2_HOME can point elsewhere (e.g. nvm setups), so resolve it on the server
  const dump = await conn.exec(
    `dump="\${PM2_HOME:-$HOME/.pm2}/dump.pm2"; if [ -e "$dump" ]; then cat "$dump"; else echo ${NO_DUMP_MARKER}; fi`,
  );
  // No dump file — pm2 has nothing to resurrect, the process is genuinely absent
  if (dump.code === 0 && dump.stdout.trim() === NO_DUMP_MARKER) return false;
  // The dump exists but cannot be read — pm2 state is unknown, err on the safe
  // side. Only stderr goes into the error: the dump body carries each process's
  // full env (tokens, DB URLs) and must never leak into the error dialog or log.
  if (dump.code !== 0) {
    throw new Error(
      t("pm2Unavailable", { stderr: dump.stderr.trim().slice(-MAX_ERROR_STDERR_CHARS) }),
    );
  }
  let entries: unknown;
  try {
    entries = JSON.parse(dump.stdout);
  } catch {
    // Unparsable dump — treat pm2 state as unknown rather than "process absent".
    // A static note instead of the dump body, which may hold secrets (see above).
    throw new Error(t("pm2Unavailable", { stderr: t("pm2DumpCorrupt") }));
  }
  // Valid JSON that is not an array is as unexpected as unparsable JSON —
  // treat pm2 state as unknown rather than "process absent"
  if (!Array.isArray(entries)) {
    throw new Error(t("pm2Unavailable", { stderr: t("pm2DumpCorrupt") }));
  }
  // Match strictly by the JSON "name" field, never by substring
  return entries.some(
    (entry) =>
      typeof entry === "object" && entry !== null && (entry as { name?: unknown }).name === name,
  );
}

/** Останавливает проект и удаляет его следы с сервера: pm2-процесс, файлы, конфиг nginx */
export async function removeDeployedProject(
  conn: SshConnection,
  name: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  // У статических сайтов pm2-процесса нет — отсутствие не ошибка
  log(t("stoppingPm2", { name }));
  // Probe pm2 before deleting anything: an unavailable daemon must not be
  // mistaken for a missing process, or the files get removed while the
  // process stays in the pm2 dump and resurrects after a server reboot.
  const jlist = await conn.exec("pm2 jlist");
  // A dead daemon does not always fail the probe: pm2 jlist spawns a fresh
  // daemon, prints its startup banner and exits 0 with an empty process table,
  // while the stale pm2 dump still holds the process. Treat the banner as
  // "pm2 was unavailable" too.
  const spawnedByProbe = /^\[PM2\] Spawning PM2 daemon/m.test(jlist.stdout);
  if (jlist.code !== 0 || spawnedByProbe) {
    if (spawnedByProbe) {
      // The probe itself spawned an empty daemon; kill it best-effort so a
      // retry hits the banner again instead of a clean empty table that looks
      // like "process absent" while the stale pm2 dump still holds the process.
      await conn.exec("pm2 kill").catch(() => {});
    }
    // pm2 often reports failures on stdout ([PM2][ERROR] ...), so include both channels
    const output = [jlist.stdout.trim(), jlist.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(t("pm2Unavailable", { stderr: output }));
  }
  if (parsePm2Jlist(jlist.stdout).some((proc) => proc.name === name)) {
    await run(conn, `pm2 delete '${name}'`, log);
    await run(conn, "pm2 save --force", log);
    log(t("pm2Stopped"));
  } else {
    // The live table says "absent", but the startup dump may still hold the
    // process (see pm2DumpHoldsProcess) — deleting the files then would bring
    // back the #82 ghost after a server reboot.
    if (await pm2DumpHoldsProcess(conn, name)) {
      throw new Error(t("pm2DumpStale", { name }));
    }
    log(t("pm2NotFound"));
  }

  log(t("removingFiles"));
  await run(
    conn,
    `rm -rf '/var/www/${name}' '/var/www/.${name}.uploading' '${envStorePath(name)}'`,
    log,
  );

  // Конфиг nginx есть только у сайтов; у ботов его нет
  const conf = await conn.exec(`test -e '/etc/nginx/sites-available/${name}.conf'`);
  if (conf.code === 0) {
    log(t("removingNginxConf"));
    await run(
      conn,
      `rm -f '/etc/nginx/sites-enabled/${name}.conf' '/etc/nginx/sites-available/${name}.conf'`,
      log,
    );
    await run(conn, "systemctl reload nginx", log);
  }

  log(t("projectRemoved", { name }));
}
