import { useEffect, useRef, useState } from "react";
import type { GithubAccount } from "../../../preload/index.d";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoggedIn: (account: GithubAccount) => void;
}

/** GitHub Device Flow: показывает код и ждёт подтверждения на github.com */
export function GithubLoginDialog({ open, onOpenChange, onLoggedIn }: Props) {
  const { t } = useI18n();
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Parents pass an inline arrow; keep it in a ref so a parent re-render does
  // not restart the effect and kick off a second device flow with a new code
  const onLoggedInRef = useRef(onLoggedIn);
  onLoggedInRef.current = onLoggedIn;

  useEffect(() => {
    if (!open) {
      setUserCode(null);
      setError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const started = await window.plantar.githubStartLogin();
      if (cancelled) return;
      if (!started.ok) {
        setError(started.error);
        return;
      }
      const { userCode, verificationUri, deviceCode, interval, expiresIn } = started.data;
      setUserCode(userCode);
      setVerificationUri(verificationUri);
      void window.plantar.openExternal(verificationUri);

      const result = await window.plantar.githubPollLogin(deviceCode, interval, expiresIn);
      if (cancelled) return;
      if (result.ok) onLoggedInRef.current(result.data);
      else setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("github.loginTitle")}</DialogTitle>
          <DialogDescription>{t("github.loginDescription")}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
            {error}
          </p>
        ) : userCode ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="text-[13px] text-ink-soft">{t("github.enterCode")}</p>
            <div className="rounded-lg border border-input bg-moss/5 px-6 py-3 font-mono text-2xl font-bold tracking-[0.3em] select-all">
              {userCode}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void window.plantar.openExternal(verificationUri)}
            >
              {t("github.openGithub")}
            </Button>
            <p className="text-[12px] text-ink-soft/80">{t("github.waiting")}</p>
          </div>
        ) : (
          <p className="py-4 text-center text-[13px] text-ink-soft">
            {t("common.connecting")}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
