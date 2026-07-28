/**
 * Per-app nginx log path templates — the single place they are spelled out.
 *
 * The nginx config writer puts these exact values into the `access_log` /
 * `error_log` directives, and every reader (log tailing, related files,
 * the desktop consent dialog and traffic stats) must reference the same
 * strings — so all of them go through these helpers to keep the write and
 * the reads from drifting apart (issues #35, #39).
 *
 * This module is intentionally pure (no Node imports) so the renderer can
 * import it via the `@plantar/core/paths` subpath without dragging
 * Node-only code into the browser bundle.
 */

export function appAccessLogPath(appName: string): string {
  return `/var/log/nginx/${appName}.access.log`;
}

export function appErrorLogPath(appName: string): string {
  return `/var/log/nginx/${appName}.error.log`;
}
