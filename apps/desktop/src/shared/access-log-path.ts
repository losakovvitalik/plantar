/**
 * Per-app nginx access log path, shared by main and renderer.
 *
 * The main process writes this exact value into the nginx config when the
 * separate visits log is enabled for an imported app, and the consent dialog
 * promises the user the very same line — so the template must live in one
 * place to keep the promise and the write from drifting apart (issue #35).
 */
export function appAccessLogPath(appName: string): string {
  return `/var/log/nginx/${appName}.access.log`;
}
