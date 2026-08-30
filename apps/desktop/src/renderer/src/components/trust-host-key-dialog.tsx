import { useEffect, useState } from "react";
import type { ServerRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
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
  /** null — the dialog is closed */
  server: ServerRecord | null;
  onClose: () => void;
  /** Called once the new key has been recorded */
  onTrusted: () => Promise<void> | void;
}

/**
 * Confirmation of the server's new identifying key. This is exactly what an
 * attacker would want clicked, so it is a deliberate step and not a button in
 * the banner: the consequence is spelled out, and the key the server answers
 * with is on screen to be compared with what the hosting provider shows.
 */
export function TrustHostKeyDialog({ server, onClose, onTrusted }: Props) {
  const { t } = useI18n();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The key comes from main, which holds it from the handshake it turned down:
  // nothing here connects to a server the app is refusing to talk to
  const serverId = server?.id;
  useEffect(() => {
    setFingerprint(null);
    setError(null);
    if (!serverId) return;
    setLoading(true);
    let cancelled = false;
    void window.plantar.getPresentedHostKey(serverId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setFingerprint(result.data);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function trust() {
    if (!server || !fingerprint) return;
    setBusy(true);
    setError(null);
    const result = await window.plantar.trustServerHostKey(server.id, fingerprint);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
    await onTrusted();
  }

  return (
    <Dialog open={server !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("trustHostKey.title", { name: server?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("trustHostKey.description")}</DialogDescription>
        </DialogHeader>

        <p className="rounded-xl bg-amber-bg px-4 py-3 text-[13px] leading-relaxed text-ink">
          {t("trustHostKey.warning")}
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">
            {t("trustHostKey.fingerprintLabel")}
          </span>
          {/* The key the server presents; nothing is recorded until it is here
              to be read, so the confirmation is never blind */}
          <code className="rounded-lg bg-ink/5 px-3 py-2 text-[12.5px] break-all select-all">
            {loading
              ? t("trustHostKey.loading")
              : (fingerprint ?? t("trustHostKey.settled"))}
          </code>
          <span className="text-[12.5px] leading-snug text-ink-soft">
            {t("trustHostKey.fingerprintHint")}
          </span>
        </div>

        {error && (
          <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void trust()} disabled={busy || !fingerprint}>
            {busy ? t("trustHostKey.saving") : t("trustHostKey.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
