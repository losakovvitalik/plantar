import { useState } from "react";
import type { ProjectRecord, ServerRecord } from "../../../preload/index.d";
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить проект «{project?.name}»?</DialogTitle>
          <DialogDescription>
            Локальная папка проекта в любом случае останется на месте.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-soft">
          <p>
            <span className="font-semibold text-ink">Убрать из списка</span> —
            проект исчезнет из Plantar, но продолжит работать на сервере.
          </p>
          <p>
            <span className="font-semibold text-ink">Удалить с сервера</span> —
            остановит процесс, уберёт его из автозапуска и удалит файлы проекта
            с сервера (у сайтов — и конфиг nginx).
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button variant="outline" onClick={removeFromList} disabled={busy}>
            Убрать из списка
          </Button>
          <Button variant="destructive" onClick={removeFromServer} disabled={busy}>
            {busy ? "Удаляю…" : "Удалить с сервера"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
