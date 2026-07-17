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
  server: ServerRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  /** Вызывается после успешного подключения — обновить состояние экрана */
  onEnabled: () => Promise<void> | void;
}

/**
 * Подтверждение подключения графиков нагрузки приложений: сбор истории
 * потребляет ресурсы сервера, поэтому включается только осознанным выбором.
 */
export function EnableAppMetricsDialog({
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
    const result = await window.plantar.enableAppMetrics(server.id, password);
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
          <DialogTitle>{t("appMetrics.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("appMetrics.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-soft">
          <p>{t("appMetrics.dialogBody")}</p>
          <p>{t("appMetrics.dialogCost")}</p>
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
            {busy ? t("appMetrics.enabling") : t("appMetrics.enable")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
