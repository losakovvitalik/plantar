import type { SiteCheckStatus } from "../../../preload/index.d";

/** Result of a successful run as the GUI presents it: the "Deploy" tab shows
 *  every case, the "History" tab only whether the run gets a link */
export type DeployOutcome =
  | { kind: "none" }
  | { kind: "link"; url: string; rolledBack: boolean }
  | { kind: "plainHttp"; url: string; plainUrl: string; rolledBack: boolean }
  | { kind: "unreachable"; url: string; rolledBack: boolean }
  | { kind: "done"; rolledBack: boolean; isBot: boolean };

/** Both the live run state and a history record fit this shape; a record
 *  written before the kind field existed has none */
interface RunResult {
  status: "running" | "success" | "error" | "interrupted";
  kind?: "deploy" | "rollback" | "migrate";
  url?: string | null;
  urlCheck?: SiteCheckStatus | null;
}

const HTTPS_PREFIX = "https://";

/**
 * A link to the app address promises a working site, so it is shown only when
 * that very address answered the check. It did not answer — a neutral line
 * instead: the code was updated, but nothing answers at that address (for an
 * imported app Plantar does not touch the web server, so the address may not
 * be set up there at all).
 *
 * plainHttp is the in-between case: the configured https address stayed silent
 * while the plain http one answered. That answer proves nothing by itself — an
 * untouched nginx replies to any unknown host on port 80 with its default site
 * or a redirect — so it gets its own wording and no confirmed link, and it
 * never replaces the configured address anywhere in the GUI.
 *
 * With no address at all there is nothing to link to: a bot simply runs, any
 * other app is only reported as updated — its address is unknown to Plantar.
 *
 * isBot only picks the wording of that address-less line, so a caller that
 * shows a link and nothing else can leave it out.
 */
export function deployOutcome(run: RunResult | null, isBot = false): DeployOutcome {
  if (!run || run.status !== "success") return { kind: "none" };
  const rolledBack = run.kind === "rollback";
  const url = run.url;
  if (!url) return { kind: "done", rolledBack, isBot };
  if (run.urlCheck === "no-answer") return { kind: "unreachable", url, rolledBack };
  if (run.urlCheck === "plain-http") {
    // plain-http is only ever set for an https address, but the record travels
    // through storage and the IPC boundary — do not take the prefix on trust
    if (!url.startsWith(HTTPS_PREFIX)) return { kind: "unreachable", url, rolledBack };
    return {
      kind: "plainHttp",
      url,
      plainUrl: `http://${url.slice(HTTPS_PREFIX.length)}`,
      rolledBack,
    };
  }
  // "answered", or a record written before the check result was stored
  return { kind: "link", url, rolledBack };
}
