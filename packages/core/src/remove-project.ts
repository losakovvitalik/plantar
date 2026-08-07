import type { SshConnection } from "@plantar/ssh";
import { parsePm2Jlist } from "./discover";
import { envStorePath } from "./env-store";
import { t } from "./messages";
import { run } from "./process-checks";

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
