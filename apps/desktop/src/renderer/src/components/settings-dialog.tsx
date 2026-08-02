import { Github, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { mcpEndpointUrl } from "@plantar/mcp/meta";
import type { AppSettings, Language } from "@plantar/storage";
import type { GithubAccount } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/ru";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Screens of the settings dialog, listed in the left-hand navigation panel */
type SettingsScreen = "general" | "integrations" | "mcp";

/** Navigation entries for the left-hand panel, one per settings screen */
const SETTINGS_SCREENS: readonly { value: SettingsScreen; labelKey: MessageKey }[] = [
  { value: "general", labelKey: "settings.screenGeneral" },
  { value: "integrations", labelKey: "settings.screenIntegrations" },
  { value: "mcp", labelKey: "settings.screenMcp" },
] as const;

/** Языки называются на самих себе — так переключатель читается на любом языке */
const LANGUAGE_NAMES: Record<Language, string> = {
  ru: "Русский",
  en: "English",
};

/**
 * Access token for the MCP endpoint, generated right in the renderer so the
 * credentials show up the moment the toggle is switched on. Same shape as
 * randomBytes(32).toString("hex") in the main process; ensureMcpToken keeps
 * an already-present token, so saving persists exactly the key shown here.
 */
function generateMcpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const { t, setLang } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<GithubAccount | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [screen, setScreen] = useState<SettingsScreen>("general");
  // Snapshot of the stored AI agent access state, refreshed whenever the
  // dialog reads settings from the main process. The endpoint starts listening
  // only on save, so the credentials block warns when the edited settings have
  // the toggle on while the stored ones have it off.
  const [storedMcpEnabled, setStoredMcpEnabled] = useState(false);

  useEffect(() => {
    if (!open) return;
    // settings === null && loadError === null → loading state
    setSettings(null);
    setLoadError(null);
    setSaveError(null);
    setAccountError(null);
    setScreen("general");
    void (async () => {
      const result = await window.plantar.getSettings();
      if (result.ok) {
        setSettings(result.data);
        setStoredMcpEnabled(result.data.mcpServerEnabled);
      } else {
        setLoadError(result.error);
      }
      const acc = await window.plantar.githubAccount();
      if (acc.ok) setAccount(acc.data);
      else setAccountError(acc.error);
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
      // The main process may have stored a corrected state (the AI agent
      // access toggle reverts when the listener fails to start) — reload so
      // the dialog does not keep showing the endpoint as available (#43)
      const fresh = await window.plantar.getSettings();
      if (fresh.ok) {
        setSettings(fresh.data);
        // The dialog shows the stored state again — refresh the snapshot too
        setStoredMcpEnabled(fresh.data.mcpServerEnabled);
        // The other changes (language included) are saved even on failure
        setLang(fresh.data.language);
      }
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the default dialog so the navigation panel and the content
          fit side by side without squeezing the controls */}
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <Tabs
          value={screen}
          onValueChange={(value) => setScreen(value as SettingsScreen)}
          orientation="vertical"
          // Fixed height so the dialog does not jump when switching screens
          className="h-[30rem] flex-row items-stretch gap-0"
        >
          {/* Full-height navigation panel with the dialog title, so the
              dialog splits into two columns like the main app sidebar */}
          <div className="flex w-44 shrink-0 flex-col gap-4 rounded-l-lg border-r border-line bg-muted p-4">
            <DialogHeader>
              <DialogTitle>{t("settings.title")}</DialogTitle>
              <DialogDescription className="sr-only">{t("settings.description")}</DialogDescription>
            </DialogHeader>
            <TabsList className="h-auto w-full flex-col items-stretch justify-start bg-transparent p-0">
              {SETTINGS_SCREENS.map(({ value, labelKey }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  // Color-based active state instead of the default shadow pill:
                  // solid accent fill so the selected screen is obvious at a glance.
                  // `!` keeps these ahead of the base TabsTrigger active styles
                  // regardless of stylesheet order (dev HMR reorders sheets).
                  className="h-auto flex-none justify-start px-3 py-1.5 data-[state=active]:bg-moss! data-[state=active]:text-white! data-[state=active]:shadow-none!"
                >
                  {t(labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Right column: scrollable content on top, footer pinned below */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Extra top padding keeps the first row clear of the close button */}
            <div className="thin-scroll flex-1 overflow-y-auto p-6 pt-12">
              {loadError ? (
                <p className="text-[13px] text-clay">
                  {t("settings.loadError", { message: loadError })}
                </p>
              ) : !settings ? (
                <p className="text-[13px] text-ink-soft">{t("settings.loading")}</p>
              ) : (
                <>
            <TabsContent value="general" className="flex flex-col gap-6">
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
            </TabsContent>

            <TabsContent value="integrations" className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label className="text-[13.5px] font-semibold">
                  {t("settings.github")}
                </Label>
                <p
                  className={`mt-1 text-[12.5px] leading-snug ${
                    !account && accountError ? "text-clay" : "text-ink-soft"
                  }`}
                >
                  {account
                    ? t("settings.githubConnected", { login: account.login })
                    : accountError
                      ? t("settings.githubStatusError", { message: accountError })
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
            </TabsContent>

            <TabsContent value="mcp">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <Label htmlFor="mcp-server" className="text-[13.5px] font-semibold">
                    {t("settings.mcpServer")}
                  </Label>
                  <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                    {t("settings.mcpServerHint")}
                  </p>
                </div>
                <Switch
                  id="mcp-server"
                  checked={settings.mcpServerEnabled}
                  onCheckedChange={(checked) => {
                    setSettings({
                      ...settings,
                      mcpServerEnabled: checked,
                      // Generate the token right away so the credentials
                      // render without a save-and-reopen round trip (#51)
                      mcpServerToken:
                        checked && !settings.mcpServerToken
                          ? generateMcpToken()
                          : settings.mcpServerToken,
                    });
                  }}
                />
              </div>
              {settings.mcpServerEnabled && (
                <div className="mt-3 flex items-start justify-between gap-6">
                  <div>
                    <Label htmlFor="mcp-allow-deploy" className="text-[13.5px] font-semibold">
                      {t("settings.mcpAllowDeploy")}
                    </Label>
                    <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                      {t("settings.mcpAllowDeployHint")}
                    </p>
                  </div>
                  <Switch
                    id="mcp-allow-deploy"
                    checked={settings.mcpAllowDeploy}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, mcpAllowDeploy: checked })
                    }
                  />
                </div>
              )}
              {settings.mcpServerEnabled && settings.mcpServerToken && (
                <div className="mt-2 flex flex-col gap-1 text-[12.5px] leading-snug">
                  <p className="text-ink-soft">{t("settings.mcpCredentialsHint")}</p>
                  <p>
                    {t("settings.mcpEndpoint")}:{" "}
                    {/* 0 — the port was never persisted, the default applies;
                        otherwise the port the listener actually bound to (#44) */}
                    <code className="select-all break-all">
                      {mcpEndpointUrl(settings.mcpServerPort || undefined)}
                    </code>
                  </p>
                  <p>
                    {t("settings.mcpToken")}:{" "}
                    <code className="select-all break-all">{settings.mcpServerToken}</code>
                  </p>
                  {/* The endpoint starts listening only when the settings are
                      saved — an unsaved enable must not look already available */}
                  {!storedMcpEnabled && (
                    <p className="text-ink-soft">{t("settings.mcpStartsAfterSave")}</p>
                  )}
                </div>
              )}
            </TabsContent>
                </>
              )}
            </div>

            {saveError && (
              <p className="px-6 pb-2 text-[13px] text-clay">
                {t("settings.saveError", { message: saveError })}
              </p>
            )}

            <DialogFooter className="border-t border-line p-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void save()} disabled={busy || !settings}>
                {busy ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </div>
        </Tabs>
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
