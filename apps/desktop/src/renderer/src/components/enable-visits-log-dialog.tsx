import { useState } from "react";
import type { ServerRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { passwordFor } from "../lib/server-auth";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface Props {
  projectId: string;
  /** The nginx config recorded for the app at import time */
  confFile: string;
  /** The per-app access log the directive will point at */
  logPath: string;
  server: ServerRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  /** Called after the log is enabled — reload the Visits card */
  onEnabled: () => Promise<void> | void;
}

/**
 * Consent dialog for a per-app visits log on an imported app. The change
 * touches the app's own nginx config, so the dialog shows the exact line to
 * be added and the file it goes into before anything runs on the server.
 */
export function EnableVisitsLogDialog({
  projectId,
  confFile,
  logPath,
  server,
  open,
  onOpenChange,
  askPassword,
  onEnabled,
}: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    if (busy) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function enable() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setBusy(true);
    setError(null);
    const result = await window.plantar.enableExternalAccessLog(projectId, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    await onEnabled();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("visitsLog.title")}</DialogTitle>
          <DialogDescription>{t("visitsLog.file", { file: confFile })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-soft">
          <p>{t("visitsLog.what")}</p>
          <p className="rounded-lg bg-line/40 px-3 py-2 font-mono text-[12px] break-all text-ink">
            access_log {logPath};
          </p>
          <p>{t("visitsLog.safety")}</p>
          <p>{t("visitsLog.after")}</p>
        </div>

        {error && (
          <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void enable()} disabled={busy}>
            {busy ? t("visitsLog.busy") : t("visitsLog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
