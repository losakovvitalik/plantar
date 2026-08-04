import { type SshConnection, shellQuote } from "@plantar/ssh";
import { t } from "./messages";
import { blankComments, findBlocks, proxyPassPorts, upstreamPorts } from "./nginx-parse";
import { run } from "./process-checks";

/**
 * In-place edits of a foreign nginx config recorded for an imported app.
 *
 * The config is hand-written, so every change is strictly additive: existing
 * lines are never rewritten, reordered or reformatted. Before a write the
 * original file is copied aside, the result is checked with `nginx -t`, and
 * the copy is restored automatically if the check or the reload fails —
 * a broken config would take down every site on the server.
 */

/** Backups live outside /etc/nginx: sites-enabled is often included with a
 *  wildcard, and a stray copy there would be loaded as a second config */
const NGINX_BACKUP_DIR = "/var/www/.plantar/nginx-backups";

export interface AccessLogInsertion {
  /** New file content; every original line is preserved byte for byte */
  content: string;
  /** Number of server blocks that received the directive */
  patched: number;
}

/**
 * Inserts an `access_log` directive into every server block that proxies to
 * the app's port and has no access_log of its own. Blocks with any existing
 * access_log directive (including `access_log off`) are left untouched —
 * `off` cancels other directives of its level, so adding one would not work
 * and would contradict the user's explicit choice. Purely additive: one new
 * line per block, right after the opening brace.
 *
 * `configUpstreams` carries upstream ports resolved from the whole active
 * config (`nginx -T`): an upstream may be declared in another file, and
 * discovery matches the port across files — the execute side must too.
 * Same-file declarations win over the config-wide map.
 */
export function addAccessLogDirective(
  confText: string,
  appPort: number,
  logPath: string,
  configUpstreams: Map<string, number[]> = new Map(),
): AccessLogInsertion {
  const clean = blankComments(confText);
  const upstreams = new Map([...configUpstreams, ...upstreamPorts(clean)]);

  const insertAt: number[] = [];
  for (const block of findBlocks(clean, "server")) {
    const body = clean.slice(block.open, block.close);
    // The whole body, nested location blocks included: discovery reads the
    // first access_log the same way, so any directive counts as "has one"
    if (/(?:^|[\s;{}])access_log\s/.test(body)) continue;
    if (!proxyPassPorts(body, upstreams).includes(appPort)) continue;
    insertAt.push(block.open);
  }

  // Insert back to front so earlier positions stay valid
  let content = confText;
  for (const pos of [...insertAt].reverse()) {
    // Match the indentation of the block's first non-empty line
    const indent =
      content.slice(pos).match(/^[ \t]*\r?\n(?:[ \t]*\r?\n)*([ \t]*)\S/)?.[1] ?? "    ";
    content = `${content.slice(0, pos)}\n${indent}access_log ${logPath};${content.slice(pos)}`;
  }
  return { content, patched: insertAt.length };
}

export interface AccessLogTarget {
  /** The nginx config recorded for the app at import time */
  confFile: string;
  /** The local port the app listens on — picks the right server blocks */
  appPort: number;
  /** The per-app access log to start writing */
  logPath: string;
}

/**
 * Copies the backup over the config; best effort — the original error stays
 * primary, the outcome only picks which message reports it. Returns false
 * when the copy itself failed, i.e. the broken config is still on disk and
 * the caller must not claim a rollback.
 */
async function restoreBackup(
  conn: SshConnection,
  backup: string,
  confFile: string,
): Promise<boolean> {
  const copied = await conn.exec(`cp ${shellQuote(backup)} ${shellQuote(confFile)}`);
  return copied.code === 0;
}

/**
 * Adds a per-app `access_log` to the app's own nginx config in place, so the
 * Visits card works without migrating the app under Plantar management.
 * Backs the file up, verifies with `nginx -t` and restores the original on
 * any failure. The config itself stays foreign — nothing else is changed.
 */
export async function enableExternalAccessLog(
  conn: SshConnection,
  target: AccessLogTarget,
  log: (line: string) => void = () => {},
): Promise<void> {
  const read = await conn.exec(`cat ${shellQuote(target.confFile)}`);
  if (read.code !== 0) {
    throw new Error(
      t("nginxConfReadFailed", {
        file: target.confFile,
        stderr: read.stderr.slice(-2000),
      }),
    );
  }

  // An upstream may be declared in a file other than the recorded one —
  // resolve ports from the whole active config, the way discovery does.
  // Best effort: if the dump fails, same-file upstreams still resolve
  const dump = await conn.exec("nginx -T 2>/dev/null");
  const configUpstreams =
    dump.code === 0 ? upstreamPorts(blankComments(dump.stdout)) : new Map<string, number[]>();

  const { content, patched } = addAccessLogDirective(
    read.stdout,
    target.appPort,
    target.logPath,
    configUpstreams,
  );
  if (patched === 0) {
    throw new Error(t("accessLogNoBlock", { file: target.confFile }));
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = target.confFile.split("/").pop() ?? "nginx.conf";
  const backup = `${NGINX_BACKUP_DIR}/${baseName}.${timestamp}`;
  log(t("accessLogBackingUp", { backup }));
  await run(
    conn,
    `mkdir -p '${NGINX_BACKUP_DIR}' && cp ${shellQuote(target.confFile)} ${shellQuote(backup)}`,
    log,
  );

  log(t("accessLogWriting", { file: target.confFile }));
  // base64 survives any content the hand-written config may hold
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const written = await conn.exec(
    `echo '${encoded}' | base64 -d > ${shellQuote(target.confFile)}`,
  );
  if (written.code !== 0) {
    const restored = await restoreBackup(conn, backup, target.confFile);
    const stderr = written.stderr.slice(-2000);
    throw new Error(
      restored
        ? t("accessLogWriteFailed", { stderr })
        : t("accessLogWriteFailedNotRestored", { file: target.confFile, backup, stderr }),
    );
  }

  const check = await conn.exec("nginx -t");
  if (check.code !== 0) {
    // The broken config was never loaded — restoring the file is enough
    const restored = await restoreBackup(conn, backup, target.confFile);
    const stderr = check.stderr.slice(-2000);
    throw new Error(
      restored
        ? t("nginxCheckFailedRestored", { stderr })
        : t("nginxCheckFailedNotRestored", { file: target.confFile, backup, stderr }),
    );
  }

  const reload = await conn.exec("systemctl reload nginx");
  if (reload.code !== 0) {
    // Reload the restored file only after a successful copy — with the copy
    // failed it would just retry the config the web server did not accept
    const restored = await restoreBackup(conn, backup, target.confFile);
    const reloaded = restored && (await conn.exec("systemctl reload nginx")).code === 0;
    const stderr = reload.stderr.slice(-2000);
    throw new Error(
      reloaded
        ? t("nginxReloadFailedRestored", { stderr })
        : t("nginxReloadFailedNotRestored", { file: target.confFile, backup, stderr }),
    );
  }

  log(t("accessLogEnabled", { logPath: target.logPath }));
}
