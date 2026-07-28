import { type SshConnection, shellQuote } from "@plantar/ssh";
import { t } from "./messages";
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

const LOCAL_HOST_RE = "(?:127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0)";

/**
 * Replaces comments with spaces of the same length: braces inside comments
 * must not break block matching, while every position in the cleaned text
 * still maps 1:1 onto the original — required for position-based insertion.
 */
function blankComments(text: string): string {
  return text.replace(/#[^\n]*/g, (comment) => " ".repeat(comment.length));
}

interface RawBlock {
  /** `<keyword> …` between the previous delimiter and the opening brace */
  header: string;
  /** Position right after the opening brace */
  open: number;
  /** Position of the closing brace; body = [open, close) */
  close: number;
}

/** `<keyword> … { … }` blocks with their positions, nested braces respected */
function findBlocks(clean: string, keyword: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const re = new RegExp(`(?:^|[\\s;{}])(${keyword}\\b[^{;]*)\\{`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    const open = match.index + match[0].length;
    let depth = 1;
    let i = open;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      i++;
    }
    blocks.push({ header: match[1].trim(), open, close: i - 1 });
    re.lastIndex = i;
  }
  return blocks;
}

/** upstream name → local ports of its servers, from the same config file */
function upstreamPorts(clean: string): Map<string, number[]> {
  const ports = new Map<string, number[]>();
  for (const block of findBlocks(clean, "upstream")) {
    const name = block.header.split(/\s+/)[1];
    if (!name) continue;
    const body = clean.slice(block.open, block.close);
    const found = [
      ...body.matchAll(new RegExp(`(?:^|\\s)server\\s+${LOCAL_HOST_RE}:(\\d+)`, "g")),
    ].map((m) => Number(m[1]));
    if (found.length > 0) ports.set(name, found);
  }
  return ports;
}

/** Does the server block proxy requests to the app's local port? */
function proxiesToPort(
  body: string,
  port: number,
  upstreams: Map<string, number[]>,
): boolean {
  for (const m of body.matchAll(/(?:^|\s)proxy_pass\s+(https?:\/\/[^;\s]+)/g)) {
    const direct = m[1].match(new RegExp(`^https?://${LOCAL_HOST_RE}:(\\d+)`));
    if (direct) {
      if (Number(direct[1]) === port) return true;
      continue;
    }
    const upstream = m[1].match(/^https?:\/\/([^/:]+)/);
    if (upstream && (upstreams.get(upstream[1]) ?? []).includes(port)) return true;
  }
  return false;
}

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
 */
export function addAccessLogDirective(
  confText: string,
  appPort: number,
  logPath: string,
): AccessLogInsertion {
  const clean = blankComments(confText);
  const upstreams = upstreamPorts(clean);

  const insertAt: number[] = [];
  for (const block of findBlocks(clean, "server")) {
    const body = clean.slice(block.open, block.close);
    // The whole body, nested location blocks included: discovery reads the
    // first access_log the same way, so any directive counts as "has one"
    if (/(?:^|[\s;{}])access_log\s/.test(body)) continue;
    if (!proxiesToPort(body, appPort, upstreams)) continue;
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

/** Copies the backup over the config; best effort — the original error wins */
async function restoreBackup(
  conn: SshConnection,
  backup: string,
  confFile: string,
): Promise<void> {
  await conn.exec(`cp ${shellQuote(backup)} ${shellQuote(confFile)}`);
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

  const { content, patched } = addAccessLogDirective(
    read.stdout,
    target.appPort,
    target.logPath,
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
    await restoreBackup(conn, backup, target.confFile);
    throw new Error(t("accessLogWriteFailed", { stderr: written.stderr.slice(-2000) }));
  }

  const check = await conn.exec("nginx -t");
  if (check.code !== 0) {
    // The broken config was never loaded — restoring the file is enough
    await restoreBackup(conn, backup, target.confFile);
    throw new Error(t("nginxCheckFailedRestored", { stderr: check.stderr.slice(-2000) }));
  }

  const reload = await conn.exec("systemctl reload nginx");
  if (reload.code !== 0) {
    await restoreBackup(conn, backup, target.confFile);
    await conn.exec("systemctl reload nginx");
    throw new Error(t("nginxReloadFailedRestored", { stderr: reload.stderr.slice(-2000) }));
  }

  log(t("accessLogEnabled", { logPath: target.logPath }));
}
