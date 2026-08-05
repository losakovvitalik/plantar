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
  /** The address the certificate is issued for */
  domain: string;
  server: ServerRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  /** Called after the certificate is issued — reload the HTTPS card */
  onEnabled: () => Promise<void> | void;
}

/**
 * Consent dialog for HTTPS on an imported app: certbot edits the app's own
 * nginx config in place, so the action runs only after the user has read
 * exactly what will happen on the server and confirmed it.
 */
export function ExternalHttpsDialog({
  projectId,
  domain,
  server,
  open,
  onOpenChange,
  askPassword,
  onEnabled,
}: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    if (busy) return;
    if (!next) {
      setError(null);
      setDone(false);
    }
    onOpenChange(next);
  }

  async function setup() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setBusy(true);
    setError(null);
    const result = await window.plantar.setupExternalHttps(projectId, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
    await onEnabled();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("httpsDialog.title", { domain })}</DialogTitle>
          <DialogDescription>{t("appStatus.httpsTitle")}</DialogDescription>
        </DialogHeader>

        {done ? (
          <p className="rounded-lg bg-moss/10 px-3 py-2 text-[13px] leading-relaxed text-moss">
            {t("httpsDialog.done")}
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-soft">
            <p>{t("httpsDialog.what", { domain })}</p>
            <p>{t("httpsDialog.safety")}</p>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
            {error}
          </p>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={() => close(false)}>{t("common.close")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void setup()} disabled={busy}>
                {busy ? t("httpsDialog.busy") : t("httpsDialog.confirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
