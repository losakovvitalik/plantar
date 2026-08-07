import type { SiteCheckStatus } from "@plantar/core";
import {
  type DeployLogWriter,
  type DeployRecord,
  appendHistory,
  readSettings,
} from "@plantar/storage";
import type { DeployRunHandle } from "./deploy-runs";
import { t } from "./i18n";

/**
 * Shared tail of every run orchestrator (deploy, external in-place deploy,
 * rollback): the one place that records history, sends the system
 * notification and closes the run snapshot, so the three flows cannot
 * drift apart again.
 */
export interface RunFinishContext {
  run: DeployRunHandle;
  /** Missing only when the run failed before the log file was created;
   *  without it there is nothing to reference — no history record is written */
  logWriter?: DeployLogWriter;
  /** History identity: project name, id and server host as of the run */
  project: string;
  projectId: string;
  host: string;
  startedAt: string;
  /** Value for the history `kind` field; a plain managed deploy leaves it
   *  undefined (history reads the absent field as an ordinary deploy) */
  kind?: DeployRecord["kind"];
  /** Sends the system notification about the result; the helper decides
   *  when to notify (a confirmed success respects notifyOnDeploySuccess,
   *  failure always notifies, and so does a success whose urlCheck says the
   *  site did not answer the post-deploy check — that warning must not be
   *  silenced by the setting), the caller only knows how. urlCheck lets the
   *  caller keep the text honest when the site never answered */
  notify: (success: boolean, urlCheck?: SiteCheckStatus) => void;
}

export type RunOutcome =
  | { status: "success"; url?: string; urlCheck?: SiteCheckStatus; commit?: string }
  | { status: "error"; err: unknown; commit?: string };

export function finishRun(ctx: RunFinishContext, outcome: RunOutcome): void {
  const common = {
    project: ctx.project,
    projectId: ctx.projectId,
    host: ctx.host,
    startedAt: ctx.startedAt,
    finishedAt: new Date().toISOString(),
    kind: ctx.kind,
    commit: outcome.commit,
  };
  try {
    if (outcome.status === "success") {
      if (ctx.logWriter) {
        appendHistory({
          ...common,
          status: "success",
          url: outcome.url,
          urlCheck: outcome.urlCheck,
          logFile: ctx.logWriter.file,
        });
      }
      // An unconfirmed site check means possible downtime — that warning
      // must reach the user even when success notifications are off
      const siteUnconfirmed =
        outcome.urlCheck === "no-answer" || outcome.urlCheck === "plain-http";
      if (siteUnconfirmed || readSettings().notifyOnDeploySuccess) {
        ctx.notify(true, outcome.urlCheck);
      }
      ctx.run.finish({ status: "success", url: outcome.url, urlCheck: outcome.urlCheck });
    } else {
      const message = (outcome.err as Error).message;
      const code = (outcome.err as { code?: string }).code;
      // Run status updates first: a disk-write failure must not leave the
      // project locked in a running deploy
      ctx.run.finish({ status: "error", error: message, code });
      ctx.notify(false);
      if (ctx.logWriter) {
        // Re-entry guard: when a success pass threw past finishRun, its
        // finally below already closed the writer before the orchestrator's
        // catch called finishRun again — skip only the log line, so the
        // error history record still lands and the original failure stays
        // the one the caller sees
        if (!ctx.logWriter.closed) {
          ctx.logWriter.write(`\n${t("deployLogError")}: ${message}`);
        }
        appendHistory({
          ...common,
          status: "error",
          error: message,
          code,
          logFile: ctx.logWriter.file,
        });
      }
    }
  } finally {
    // The run is over either way — release the log file's descriptor even
    // when a disk write above threw (the failure still reaches the caller)
    ctx.logWriter?.close();
  }
}
