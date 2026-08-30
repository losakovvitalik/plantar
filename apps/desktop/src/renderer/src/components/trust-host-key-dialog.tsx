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
  // The lookup came back without a key: the server presents the recorded one
  // again. Kept apart from a lookup that failed, which says nothing at all
  // about which key the server presents
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reads the key main holds for this server — from the handshake it turned
   * down, so nothing here connects to a server the app is refusing to talk to.
   * Asked on opening and again after a refused confirmation: what is on screen
   * has to be the key the app would record, and a refusal means it no longer is.
   */
  async function loadPresentedKey(id: string, token = { cancelled: false }): Promise<void> {
    setLoading(true);
    const result = await window.plantar.getPresentedHostKey(id);
    if (token.cancelled) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFingerprint(result.data);
    setSettled(result.data === null);
  }

  const serverId = server?.id;
  useEffect(() => {
    setFingerprint(null);
    setSettled(false);
    setError(null);
    if (!serverId) {
      // Closed while a lookup was in flight: its answer is dropped, so the
      // loading state is dropped here instead of outliving the dialog
      setLoading(false);
      return;
    }
    const token = { cancelled: false };
    void loadPresentedKey(serverId, token);
    return () => {
      token.cancelled = true;
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
      // Refused because the key on screen is no longer the one the server
      // answers with — show the one it answers with now, so the confirmation
      // can be repeated here instead of through closing and opening again
      await loadPresentedKey(server.id);
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
            {/* A lookup that failed must not claim the previous key is back */}
            {loading
              ? t("trustHostKey.loading")
              : (fingerprint ?? (settled ? t("trustHostKey.settled") : "—"))}
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
