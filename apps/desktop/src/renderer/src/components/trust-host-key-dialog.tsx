import { useEffect, useRef, useState } from "react";
import type { HostKey, ServerRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { deployOnCommitProjectNames } from "../lib/deploy-on-commit";
import { hostKeyTypeLabel } from "../lib/host-key-type";
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
  const [hostKey, setHostKey] = useState<HostKey | null>(null);
  // The lookup came back without a key: the server presents the recorded one
  // again. Kept apart from a lookup that failed, which says nothing at all
  // about which key the server presents
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Names of this server's projects with deploy on commit set up: GitHub keeps
  // its own copy of the host key for them, which confirming here leaves on the
  // previous one — the dialog names exactly these as needing setting up again
  const [deployOnCommitProjects, setDeployOnCommitProjects] = useState<string[]>([]);
  // The dialog stays mounted between openings, so a lookup can outlive the
  // server it was asked about. Every lookup takes the token current when it
  // starts and is dropped once that token has moved on
  const requestToken = useRef(0);
  // The key the box is showing, which is what the label and the hint speak
  // about. A lookup in flight leaves the key of the previous answer in hand,
  // and naming its type would point at a line the box is not showing
  const shownKey = loading ? null : hostKey;

  /**
   * Reads the key main holds for this server — from the handshake it turned
   * down, so nothing here connects to a server the app is refusing to talk to.
   * Asked on opening and again after a refused confirmation: what is on screen
   * has to be the key the app would record, and a refusal means it no longer is.
   */
  async function loadPresentedKey(id: string): Promise<void> {
    const token = ++requestToken.current;
    setLoading(true);
    const result = await window.plantar.getPresentedHostKey(id);
    // Closing the dialog moved the token on: this answer is about the server
    // that was on screen then, and must not land in the one on screen now
    if (token !== requestToken.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHostKey(result.data);
    setSettled(result.data === null);
  }

  const serverId = server?.id;
  useEffect(() => {
    setHostKey(null);
    setSettled(false);
    setError(null);
    setDeployOnCommitProjects([]);
    if (!serverId) {
      // Closed while a lookup was in flight: its answer is dropped, so the
      // loading state is dropped here instead of outliving the dialog
      setLoading(false);
      return;
    }
    void loadPresentedKey(serverId);
    // Read on opening rather than taken from the window's state: the marker is
    // written when deploy on commit is set up, which no list refresh follows.
    // The note is advisory — a failed read leaves it out rather than blocking
    // the confirmation on it
    let cancelled = false;
    void window.plantar.listProjects().then((result) => {
      if (cancelled || !result.ok) return;
      setDeployOnCommitProjects(deployOnCommitProjectNames(result.data, serverId));
    });
    return () => {
      cancelled = true;
      // Cancels whatever lookup is in flight, the effect's own and the re-read
      // after a refused confirmation alike — both carry a token from here
      requestToken.current += 1;
    };
  }, [serverId]);

  function close() {
    if (busy) return;
    onClose();
  }

  async function trust() {
    if (!server || !hostKey) return;
    setBusy(true);
    setError(null);
    const result = await window.plantar.trustServerHostKey(server.id, hostKey.fingerprint);
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

        {/* Shown only when this server actually has such projects — for anyone
            else the sentence about setting deploy on commit up again is noise —
            and only while there is a new key to confirm: with the question
            settled or still loading, nothing here would break those deploys */}
        {shownKey && deployOnCommitProjects.length > 0 && (
          <p className="rounded-lg border border-line bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft">
            {t("trustHostKey.deployOnCommitNote", {
              projects: deployOnCommitProjects.join(", "),
            })}
          </p>
        )}

        <p className="rounded-xl bg-amber-bg px-4 py-3 text-[13px] leading-relaxed text-ink">
          {t("trustHostKey.warning")}
        </p>

        <div className="flex flex-col gap-1.5">
          {/* A control panel lists a server's keys one per type, so the label
              names the type of this one — that is the line to compare with */}
          <span className="text-[13px] font-semibold">
            {shownKey
              ? t("trustHostKey.fingerprintLabelTyped", {
                  type: hostKeyTypeLabel(shownKey.type),
                })
              : t("trustHostKey.fingerprintLabel")}
          </span>
          {/* The key the server presents; nothing is recorded until it is here
              to be read, so the confirmation is never blind. The type stays out
              of the box: what is selected here is meant to be the fingerprint */}
          <code className="rounded-lg bg-ink/5 px-3 py-2 text-[12.5px] break-all select-all">
            {/* A lookup that failed must not claim the previous key is back */}
            {loading
              ? t("trustHostKey.loading")
              : (hostKey?.fingerprint ?? (settled ? t("trustHostKey.settled") : "—"))}
          </code>
          {/* The hint sends the user to the panel line of the type named above,
              so it is shown only while there is a type to name — with the box
              still loading, settled or empty there is nothing to compare */}
          {shownKey && (
            <span className="text-[12.5px] leading-snug text-ink-soft">
              {t("trustHostKey.fingerprintHint")}
            </span>
          )}
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
          {/* Nothing to confirm while the box shows no key: during the re-read
              after a refusal the one held here is the key just turned down */}
          <Button onClick={() => void trust()} disabled={busy || loading || !hostKey}>
            {busy ? t("trustHostKey.saving") : t("trustHostKey.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
