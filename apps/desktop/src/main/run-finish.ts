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
   *  when to notify (success respects notifyOnDeploySuccess, failure always
   *  notifies), the caller only knows how */
  notify: (success: boolean) => void;
}

export type RunOutcome =
  | { status: "success"; url?: string; urlCheck?: SiteCheckStatus; commit?: string }
  | { status: "error"; err: unknown; commit?: string };

export function finishRun(ctx: RunFinishContext, outcome: RunOutcome): void {
  const identity = {
    project: ctx.project,
    projectId: ctx.projectId,
    host: ctx.host,
    startedAt: ctx.startedAt,
    finishedAt: new Date().toISOString(),
    kind: ctx.kind,
    commit: outcome.commit,
  };
  if (outcome.status === "success") {
    if (ctx.logWriter) {
      appendHistory({
        ...identity,
        status: "success",
        url: outcome.url,
        urlCheck: outcome.urlCheck,
        logFile: ctx.logWriter.file,
      });
    }
    if (readSettings().notifyOnDeploySuccess) ctx.notify(true);
    ctx.run.finish({ status: "success", url: outcome.url, urlCheck: outcome.urlCheck });
  } else {
    const message = (outcome.err as Error).message;
    const code = (outcome.err as { code?: string }).code;
    // Run status updates first: a disk-write failure must not leave the
    // project locked in a running deploy
    ctx.run.finish({ status: "error", error: message, code });
    ctx.notify(false);
    if (ctx.logWriter) {
      ctx.logWriter.write(`\n${t("deployLogError")}: ${message}`);
      appendHistory({
        ...identity,
        status: "error",
        error: message,
        code,
        logFile: ctx.logWriter.file,
      });
    }
  }
}
