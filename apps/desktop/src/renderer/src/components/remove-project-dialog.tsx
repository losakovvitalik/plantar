import { useState } from "react";
import type { ProjectRecord, ServerRecord } from "../../../preload/index.d";
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

interface Props {
  /** null — диалог закрыт */
  project: ProjectRecord | null;
  server: ServerRecord | null;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  onClose: () => void;
  /** Вызывается после удаления проекта из списка */
  onRemoved: () => Promise<void>;
}

/** Удаление проекта: только из списка или вместе с остановкой на сервере */
export function RemoveProjectDialog({
  project,
  server,
  askPassword,
  onClose,
  onRemoved,
}: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  async function removeFromList() {
    if (!project) return;
    const result = await window.plantar.removeProject(project.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    close();
    await onRemoved();
  }

  async function removeFromServer() {
    if (!project || !server) return;
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setBusy(true);
    setError(null);
    const result = await window.plantar.removeProjectFromServer(project.id, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await window.plantar.removeProject(project.id);
    close();
    await onRemoved();
  }

  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("removeProject.title", { name: project?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("removeProject.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-soft">
          <p>
            <span className="font-semibold text-ink">
              {t("removeProject.fromList")}
            </span>
            {t("removeProject.fromListHint")}
          </p>
          <p>
            <span className="font-semibold text-ink">
              {t("removeProject.fromServer")}
            </span>
            {t("removeProject.fromServerHint")}
          </p>
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
          <Button variant="outline" onClick={removeFromList} disabled={busy}>
            {t("removeProject.fromList")}
          </Button>
          <Button
            variant="destructive"
            className="dark:bg-destructive"
            onClick={removeFromServer}
            disabled={busy}
          >
            {busy ? t("removeProject.removing") : t("removeProject.fromServer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
