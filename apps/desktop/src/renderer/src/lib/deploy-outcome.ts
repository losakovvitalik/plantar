/** Result of a successful run as the GUI presents it: the "Deploy" tab shows
 *  every case, the "History" tab only whether the run gets a link */
export type DeployOutcome =
  | { kind: "none" }
  | { kind: "link"; url: string; rolledBack: boolean }
  | { kind: "unreachable"; url: string; rolledBack: boolean }
  | { kind: "done"; rolledBack: boolean; isBot: boolean };

/** Both the live run state and a history record fit this shape; a record
 *  written before the kind field existed has none */
interface RunResult {
  status: "running" | "success" | "error" | "interrupted";
  kind?: "deploy" | "rollback" | "migrate";
  url?: string | null;
  urlReachable?: boolean | null;
}

/**
 * A link to the app address promises a working site, so it is shown only when
 * the address answered the check. It did not answer — a neutral line instead:
 * the code was updated, but nothing answers at that address (for an imported
 * app Plantar does not touch the web server, the domain may be unchanged).
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
  if (!run.url) return { kind: "done", rolledBack, isBot };
  return {
    kind: run.urlReachable === false ? "unreachable" : "link",
    url: run.url,
    rolledBack,
  };
}
