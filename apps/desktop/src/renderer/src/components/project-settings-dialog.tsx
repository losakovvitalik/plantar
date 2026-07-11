import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectConfigInput } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/ru";
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
import { NextLogo, NodeLogo, ReactLogo, TelegramLogo } from "./tech-logos";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

type ProjectType = "static" | "node" | "next" | "bot";

const PROJECT_TYPES: Array<{
  value: ProjectType;
  labelKey: MessageKey;
  hintKey: MessageKey;
  Logo: (props: { className?: string }) => React.JSX.Element;
}> = [
  {
    value: "static",
    labelKey: "projectSettings.typeStaticLabel",
    hintKey: "projectSettings.typeStaticHint",
    Logo: ReactLogo,
  },
  {
    value: "node",
    labelKey: "projectSettings.typeNodeLabel",
    hintKey: "projectSettings.typeNodeHint",
    Logo: NodeLogo,
  },
  {
    value: "next",
    labelKey: "projectSettings.typeNextLabel",
    hintKey: "projectSettings.typeNextHint",
    Logo: NextLogo,
  },
  {
    value: "bot",
    labelKey: "projectSettings.typeBotLabel",
    hintKey: "projectSettings.typeBotHint",
    Logo: TelegramLogo,
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  folderPath: string;
  initial: Partial<ProjectConfigInput>;
  /** Подсказка об источнике настроек (автоопределение / plantar.json) */
  note?: string;
  submitLabel: string;
  /** Возвращает текст ошибки или null при успехе; branch передаётся, только если её сменили */
  onSubmit: (
    config: ProjectConfigInput,
    subdir?: string,
    branch?: string,
  ) => Promise<string | null>;
  /** Сообщение об успешном сохранении — показывается внутри диалога */
  savedMessage?: string;
  /** Обработчик кнопки «Деплой» рядом с сообщением о сохранении */
  onDeploy?: () => void;
  /** Корень клона git-проекта — включает выбор подпапки проекта; пусто — выбора нет */
  repoRoot?: string;
  /** Текущая подпапка проекта внутри репозитория ("" — корень) */
  initialSubdir?: string;
  /** Ссылка на репозиторий git-проекта — включает смену ветки; пусто — смены нет */
  repoUrl?: string;
  /** Текущая ветка git-проекта */
  initialBranch?: string;
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  title,
  folderPath,
  initial,
  note,
  submitLabel,
  onSubmit,
  savedMessage,
  onDeploy,
  repoRoot,
  initialSubdir,
  repoUrl,
  initialBranch,
}: Props) {
  const { t } = useI18n();
  const [type, setType] = useState<ProjectType>("static");
  const [runtime, setRuntime] = useState<"node" | "python">("node");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [packageManager, setPackageManager] =
    useState<ProjectConfigInput["packageManager"]>("npm");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [buildDir, setBuildDir] = useState("dist");
  const [startCommand, setStartCommand] = useState("");
  const [port, setPort] = useState("");
  const [subdir, setSubdir] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Заполняет поля формы значениями конфига (при открытии и при смене папки) */
  function applyConfig(c: Partial<ProjectConfigInput>) {
    setType(c.type ?? "static");
    setRuntime(c.runtime ?? "node");
    setName(c.name ?? "");
    setDomain(c.domain ?? "");
    setPackageManager(c.packageManager ?? "npm");
    setBuildCommand(c.buildCommand ?? "npm run build");
    setBuildDir(c.buildDir ?? "dist");
    setStartCommand(c.startCommand ?? "");
    setPort(c.port ? String(c.port) : "");
  }

  useEffect(() => {
    if (open) {
      applyConfig(initial);
      setSubdir(initialSubdir ?? "");
      setBranch(initialBranch ?? "");
      setBranches(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Загружает список веток репозитория и включает их выбор */
  async function loadBranches() {
    if (!repoUrl) return;
    setBranchesLoading(true);
    setError(null);
    const result = await window.plantar.listRepoBranches(repoUrl);
    setBranchesLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBranches(result.data.branches);
  }

  /** Выбор подпапки проекта внутри репозитория с переопределением настроек по ней */
  async function pickSubdir() {
    if (!repoRoot) return;
    const result = await window.plantar.pickSubdir(repoRoot);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data) return; // пользователь закрыл выбор
    setSubdir(result.data.subdir);
    applyConfig(result.data.config ?? result.data.detected.config);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      setError(t("projectSettings.nameError"));
      return;
    }
    const portValue = port.trim() ? Number(port.trim()) : undefined;
    if (port.trim() && (!/^\d+$/.test(port.trim()) || portValue! < 1 || portValue! > 65535)) {
      setError(t("projectSettings.portError"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit({
      // Порт статических сайтов и ботов диалог не редактирует — сохраняем как есть
      port: type === "node" || type === "next" ? portValue : initial.port,
      type,
      runtime: type === "bot" ? runtime : undefined,
      name,
      packageManager,
      buildCommand: buildCommand.trim() || undefined,
      buildDir: buildDir.trim() || undefined,
      startCommand: startCommand.trim() || undefined,
      // Бот работает без домена — не тащим его из прежних настроек
      domain: type === "bot" ? undefined : domain.trim() || undefined,
    },
    repoRoot ? subdir : undefined,
    branch && branch !== initialBranch ? branch : undefined);
    setBusy(false);
    if (result) setError(result);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate font-mono text-[12px]">
            {folderPath}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {note && (
            <p className="rounded-lg bg-moss/10 px-3 py-2 text-[12.5px] leading-snug text-moss">
              {note}
            </p>
          )}

          {repoUrl && initialBranch && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-branch">{t("projectSettings.branch")}</Label>
              {branches ? (
                <Select
                  id="prj-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  {(branches.includes(branch) ? branches : [branch, ...branches]).map(
                    (b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ),
                  )}
                </Select>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-md border border-input bg-moss/5 px-3 py-1.5 font-mono text-[12.5px]">
                    {branch}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void loadBranches()}
                    disabled={branchesLoading}
                  >
                    {branchesLoading
                      ? t("common.loading")
                      : t("projectSettings.branchChange")}
                  </Button>
                </div>
              )}
              {branches && (
                <p className="text-[12px] leading-snug text-ink-soft/80">
                  {t("projectSettings.branchHint")}
                </p>
              )}
            </div>
          )}

          {repoRoot && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("projectSettings.subdir")}</Label>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-input bg-moss/5 px-3 py-1.5 font-mono text-[12.5px]">
                  {subdir || t("projectSettings.subdirRoot")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void pickSubdir()}
                >
                  {t("projectSettings.subdirPick")}
                </Button>
              </div>
              <p className="text-[12px] leading-snug text-ink-soft/80">
                {t("projectSettings.subdirHint")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>{t("projectSettings.type")}</Label>
            <div className="grid grid-cols-2 gap-3">
              {PROJECT_TYPES.map(({ value, labelKey, hintKey, Logo }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  aria-pressed={type === value}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                    type === value
                      ? "border-moss bg-moss/10"
                      : "border-input hover:bg-moss/5"
                  }`}
                >
                  <Logo className="size-7 shrink-0" />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{t(labelKey)}</span>
                    <span className="text-[11.5px] leading-snug text-ink-soft">
                      {t(hintKey)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prj-name">{t("projectSettings.name")}</Label>
            <Input
              id="prj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              required
              autoFocus
            />
            <p className="text-[12px] leading-snug text-ink-soft/80">
              {t("projectSettings.nameHint")}
            </p>
          </div>

          {type !== "bot" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-domain">{t("projectSettings.domain")}</Label>
              <Input
                id="prj-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={t("projectSettings.domainPlaceholder")}
              />
              <p className="text-[12px] leading-snug text-ink-soft/80">
                {t("projectSettings.domainHint")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {type === "bot" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prj-runtime">{t("projectSettings.runtime")}</Label>
                <Select
                  id="prj-runtime"
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value as "node" | "python")}
                >
                  <option value="node">Node.js</option>
                  <option value="python">Python</option>
                </Select>
              </div>
            )}
            {!(type === "bot" && runtime === "python") && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prj-pm">{t("projectSettings.packageManager")}</Label>
                <Select
                  id="prj-pm"
                  value={packageManager}
                  onChange={(e) =>
                    setPackageManager(
                      e.target.value as ProjectConfigInput["packageManager"],
                    )
                  }
                >
                  {PACKAGE_MANAGERS.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {type === "static" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prj-dist">{t("projectSettings.buildDir")}</Label>
                <Input
                  id="prj-dist"
                  value={buildDir}
                  onChange={(e) => setBuildDir(e.target.value)}
                />
              </div>
            )}
            {(type === "node" || type === "next") && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prj-port">{t("projectSettings.port")}</Label>
                <Input
                  id="prj-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={t("projectSettings.portPlaceholder")}
                  inputMode="numeric"
                />
              </div>
            )}
          </div>

          {(type === "static" || type === "next") && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-build">{t("projectSettings.buildCommand")}</Label>
              <Input
                id="prj-build"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
              />
              <p className="text-[12px] leading-snug text-ink-soft/80">
                {t("projectSettings.buildCommandHint")}{" "}
                <span className="font-mono">
                  npm run build -- --mode staging
                </span>
                .
              </p>
            </div>
          )}

          {type !== "static" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-start">{t("projectSettings.startCommand")}</Label>
              <Input
                id="prj-start"
                value={startCommand}
                onChange={(e) => setStartCommand(e.target.value)}
                placeholder={
                  type === "bot" && runtime === "python"
                    ? "python bot.py"
                    : `${packageManager} start`
                }
              />
              {type === "bot" ? (
                <p className="text-[12px] leading-snug text-ink-soft/80">
                  {t("projectSettings.botStartHint")}
                </p>
              ) : (
                <p className="text-[12px] leading-snug text-ink-soft/80">
                  {t("projectSettings.nodeStartHintBefore")}{" "}
                  <span className="font-mono">PORT</span>
                  {t("projectSettings.nodeStartHintAfter")}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
              {error}
            </p>
          )}

          {savedMessage && !error && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-moss/10 px-3 py-2">
              <p className="text-[12.5px] leading-snug text-moss">{savedMessage}</p>
              {onDeploy && (
                <Button type="button" size="sm" className="shrink-0" onClick={onDeploy}>
                  <Rocket className="size-3.5" />
                  {t("projectSettings.deploy")}
                </Button>
              )}
            </div>
          )}

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {savedMessage ? t("common.close") : t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name}>
              {busy ? t("common.saving") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
