import { FolderOpen, Github } from "lucide-react";
import { useState } from "react";
import type { PickedProject } from "../../../preload/index.d";
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
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Пользователь выбрал источник «папка» — родитель открывает системный выбор папки */
  onPickLocal: () => void;
  /** Репозиторий склонирован — родитель показывает форму настроек проекта */
  onCloned: (result: PickedProject, repoUrl: string, branch: string) => void;
}

export function AddProjectDialog({ open, onOpenChange, onPickLocal, onCloned }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"choose" | "git">("choose");
  const [repoUrl, setRepoUrl] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("choose");
    setRepoUrl("");
    setBranches(null);
    setBranch("");
    setBusy(false);
    setError(null);
  }

  function change(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  async function loadBranches() {
    setBusy(true);
    setError(null);
    const result = await window.plantar.listRepoBranches(repoUrl.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBranches(result.data.branches);
    setBranch(result.data.default);
  }

  async function clone() {
    setBusy(true);
    setError(null);
    const result = await window.plantar.cloneRepo(repoUrl.trim(), branch);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCloned(result.data, repoUrl.trim(), branch);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addProjectDialog.title")}</DialogTitle>
          <DialogDescription>
            {mode === "choose"
              ? t("addProjectDialog.description")
              : t("addProjectDialog.gitDescription")}
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" ? (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                onPickLocal();
                change(false);
              }}
              className="flex items-center gap-3 rounded-lg border border-input px-3 py-3 text-left outline-none hover:bg-moss/5 focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <FolderOpen className="size-6 shrink-0 text-moss" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold">
                  {t("addProjectDialog.localTitle")}
                </span>
                <span className="text-[12px] leading-snug text-ink-soft">
                  {t("addProjectDialog.localHint")}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMode("git")}
              className="flex items-center gap-3 rounded-lg border border-input px-3 py-3 text-left outline-none hover:bg-moss/5 focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <Github className="size-6 shrink-0 text-moss" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold">
                  {t("addProjectDialog.gitTitle")}
                </span>
                <span className="text-[12px] leading-snug text-ink-soft">
                  {t("addProjectDialog.gitHint")}
                </span>
              </span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repo-url">{t("addProjectDialog.repoUrl")}</Label>
              <Input
                id="repo-url"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  // Ветки относятся к прежней ссылке — перезагрузим для новой
                  setBranches(null);
                }}
                placeholder="https://github.com/user/repo"
                autoFocus
              />
              <p className="text-[12px] leading-snug text-ink-soft/80">
                {t("addProjectDialog.privateHint")}
              </p>
            </div>

            {branches && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="repo-branch">{t("addProjectDialog.branch")}</Label>
                <select
                  id="repo-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="border-input focus-visible:border-ring/60 focus-visible:ring-ring/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2"
                >
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
                {error}
              </p>
            )}

            <DialogFooter className="mt-1">
              <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
                {t("common.back")}
              </Button>
              {branches ? (
                <Button type="button" onClick={() => void clone()} disabled={busy}>
                  {busy ? t("addProjectDialog.cloning") : t("addProjectDialog.clone")}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void loadBranches()}
                  disabled={busy || !repoUrl.trim()}
                >
                  {busy ? t("common.loading") : t("common.next")}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
