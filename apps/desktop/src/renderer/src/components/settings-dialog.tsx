import { Github, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, Language } from "@plantar/storage";
import type { GithubAccount } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { GithubLoginDialog } from "./github-login-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Языки называются на самих себе — так переключатель читается на любом языке */
const LANGUAGE_NAMES: Record<Language, string> = {
  ru: "Русский",
  en: "English",
};

export function SettingsDialog({ open, onOpenChange }: Props) {
  const { t, setLang } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<GithubAccount | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const result = await window.plantar.getSettings();
      if (result.ok) setSettings(result.data);
      const acc = await window.plantar.githubAccount();
      if (acc.ok) setAccount(acc.data);
    })();
  }, [open]);

  async function signOutGithub() {
    await window.plantar.githubSignOut();
    setAccount(null);
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    const result = await window.plantar.setSettings({
      ...settings,
      letsEncryptEmail: settings.letsEncryptEmail.trim(),
    });
    setBusy(false);
    if (result.ok) {
      setLang(settings.language);
      onOpenChange(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("settings.description")}</DialogDescription>
        </DialogHeader>

        {settings && (
          <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label className="text-[13.5px] font-semibold">
                  {t("settings.github")}
                </Label>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                  {account
                    ? t("settings.githubConnected", { login: account.login })
                    : t("settings.githubHint")}
                </p>
              </div>
              {account ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void signOutGithub()}
                >
                  <LogOut className="size-3.5" />
                  {t("settings.githubSignOut")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setLoginOpen(true)}
                >
                  <Github className="size-3.5" />
                  {t("settings.githubConnect")}
                </Button>
              )}
            </div>

            <div className="flex items-start justify-between gap-6">
              <Label htmlFor="app-language" className="text-[13.5px] font-semibold">
                {t("settings.language")}
              </Label>
              <select
                id="app-language"
                value={settings.language}
                onChange={(e) =>
                  setSettings({ ...settings, language: e.target.value as Language })
                }
                className="border-input focus-visible:border-ring/60 focus-visible:ring-ring/30 h-9 w-40 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2"
              >
                {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
                  <option key={lang} value={lang}>
                    {LANGUAGE_NAMES[lang]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="log-copies" className="text-[13.5px] font-semibold">
                  {t("settings.logCopies")}
                </Label>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                  {t("settings.logCopiesHint")}
                </p>
              </div>
              <Switch
                id="log-copies"
                checked={settings.saveServerLogCopies}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, saveServerLogCopies: checked })
                }
              />
            </div>

            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="notify-success" className="text-[13.5px] font-semibold">
                  {t("settings.notifySuccess")}
                </Label>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                  {t("settings.notifySuccessHint")}
                </p>
              </div>
              <Switch
                id="notify-success"
                checked={settings.notifyOnDeploySuccess}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, notifyOnDeploySuccess: checked })
                }
              />
            </div>

            <div>
              <Label htmlFor="le-email" className="text-[13.5px] font-semibold">
                {t("settings.leEmail")}
              </Label>
              <p className="mt-1 mb-2 text-[12.5px] leading-snug text-ink-soft">
                {t("settings.leEmailHint")}
              </p>
              <Input
                id="le-email"
                type="email"
                placeholder="you@example.com"
                value={settings.letsEncryptEmail}
                onChange={(e) => setSettings({ ...settings, letsEncryptEmail: e.target.value })}
                className="max-w-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !settings}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <GithubLoginDialog
      open={loginOpen}
      onOpenChange={setLoginOpen}
      onLoggedIn={(acc) => {
        setAccount(acc);
        setLoginOpen(false);
      }}
    />
    </>
  );
}
