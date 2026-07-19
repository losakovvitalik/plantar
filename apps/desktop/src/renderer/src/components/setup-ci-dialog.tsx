import { useEffect, useState } from "react";
import type {
  GithubAccount,
  ProjectRecord,
  ServerRecord,
  SetupActionsResult,
} from "../../../preload/index.d";
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
import { GithubLoginDialog } from "./github-login-dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRecord;
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

/**
 * Настройка деплоя при коммите: объясняет, что произойдёт (ключ для GitHub,
 * Secrets, коммит workflow), и запускает автонастройку через github:setupActions.
 */
export function SetupCiDialog({ open, onOpenChange, project, server, askPassword }: Props) {
  const { t } = useI18n();
  // undefined — ещё загружается, null — вход в GitHub не выполнен
  const [account, setAccount] = useState<GithubAccount | null | undefined>(undefined);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SetupActionsResult | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setDone(null);
      setBusy(false);
      return;
    }
    setAccount(undefined);
    let cancelled = false;
    void window.plantar.githubAccount().then((result) => {
      if (cancelled) return;
      setAccount(result.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function run() {
    setError(null);
    const password = await passwordFor(server, askPassword);
    if (password === null) return; // ввод пароля отменён
    setBusy(true);
    const result = await window.plantar.setupGithubActions(project.id, password);
    setBusy(false);
    if (result.ok) setDone(result.data);
    else setError(result.error);
  }

  const branch = project.branch ?? "";
  // Вход не выполнен или у прежнего входа нет права менять файлы автоматизации
  const needsLogin = account === null || (account !== undefined && !account.canWriteWorkflows);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("ciSetup.title")}</DialogTitle>
            <DialogDescription>
              {t("ciSetup.description", { branch, server: server.name })}
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <div className="flex flex-col gap-2 py-1">
              <p className="text-[13px] leading-relaxed">
                {t("ciSetup.done", { branch: done.branch })}
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-soft">
                {t("ciSetup.doneHistoryNote")}
              </p>
            </div>
          ) : needsLogin ? (
            <p className="py-1 text-[13px] leading-relaxed text-ink-soft">
              {account === null ? t("ciSetup.loginNeeded") : t("ciSetup.reloginNeeded")}
            </p>
          ) : (
            <div className="flex flex-col gap-3 py-1">
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-relaxed text-ink-soft">
                <li>{t("ciSetup.will1")}</li>
                <li>{t("ciSetup.will2")}</li>
                <li>{t("ciSetup.will3", { branch })}</li>
              </ul>
              <p className="rounded-lg border border-line bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft">
                {t("ciSetup.secretsNote")}
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
              {error}
            </p>
          )}

          <DialogFooter>
            {done ? (
              <>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {t("common.close")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void window.plantar.openExternal(done.actionsUrl)}
                >
                  {t("ciSetup.openActions")}
                </Button>
              </>
            ) : needsLogin ? (
              <>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" onClick={() => setLoginOpen(true)}>
                  {account === null ? t("ciSetup.login") : t("ciSetup.relogin")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={busy || account === undefined}
                  onClick={() => void run()}
                >
                  {busy ? t("ciSetup.working") : t("ciSetup.submit")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GithubLoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onLoggedIn={(loggedIn) => {
          setAccount(loggedIn);
          setLoginOpen(false);
        }}
      />
    </>
  );
}
