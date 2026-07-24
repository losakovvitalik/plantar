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
import { Select } from "./ui/select";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<GithubAccount | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // settings === null && loadError === null → loading state
    setSettings(null);
    setLoadError(null);
    setSaveError(null);
    void (async () => {
      const result = await window.plantar.getSettings();
      if (result.ok) setSettings(result.data);
      else setLoadError(result.error);
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
    setSaveError(null);
    const result = await window.plantar.setSettings({
      ...settings,
      letsEncryptEmail: settings.letsEncryptEmail.trim(),
    });
    setBusy(false);
    if (result.ok) {
      setLang(settings.language);
      onOpenChange(false);
    } else {
      setSaveError(result.error);
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

        {loadError ? (
          <p className="text-[13px] text-clay">
            {t("settings.loadError", { message: loadError })}
          </p>
        ) : !settings ? (
          <p className="text-[13px] text-ink-soft">{t("settings.loading")}</p>
        ) : (
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
              <Select
                id="app-language"
                value={settings.language}
                onChange={(e) =>
                  setSettings({ ...settings, language: e.target.value as Language })
                }
                className="w-40"
              >
                {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
                  <option key={lang} value={lang}>
                    {LANGUAGE_NAMES[lang]}
                  </option>
                ))}
              </Select>
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

            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="notify-app-down" className="text-[13.5px] font-semibold">
                  {t("settings.notifyAppDown")}
                </Label>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                  {t("settings.notifyAppDownHint")}
                </p>
              </div>
              <Switch
                id="notify-app-down"
                checked={settings.notifyOnAppDown}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, notifyOnAppDown: checked })
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

        {saveError && (
          <p className="text-[13px] text-clay">
            {t("settings.saveError", { message: saveError })}
          </p>
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
