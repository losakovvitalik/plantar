import { useEffect, useState } from "react";
import type { ProjectConfigInput } from "../../../preload/index.d";
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
  title: string;
  folderPath: string;
  initial: Partial<ProjectConfigInput>;
  submitLabel: string;
  /** Возвращает текст ошибки или null при успехе */
  onSubmit: (config: ProjectConfigInput) => Promise<string | null>;
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  title,
  folderPath,
  initial,
  submitLabel,
  onSubmit,
}: Props) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [buildDir, setBuildDir] = useState("dist");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial.name ?? "");
      setDomain(initial.domain ?? "");
      setBuildCommand(initial.buildCommand ?? "npm run build");
      setBuildDir(initial.buildDir ?? "dist");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      setError("Название: только строчные латинские буквы, цифры и дефис.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit({
      name,
      buildCommand: buildCommand.trim() || undefined,
      buildDir: buildDir.trim() || undefined,
      domain: domain.trim() || undefined,
    });
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prj-name">Название</Label>
            <Input
              id="prj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              required
              autoFocus
            />
            <p className="text-[12px] leading-snug text-ink-soft/80">
              Строчные латинские буквы, цифры и дефис. Так будет называться папка сайта на
              сервере.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prj-domain">Домен</Label>
            <Input
              id="prj-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.mysite.ru"
            />
            <p className="text-[12px] leading-snug text-ink-soft/80">
              С доменом сайт получит HTTPS-сертификат автоматически. Оставь пустым — сайт будет
              открываться по IP сервера.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-build">Команда сборки</Label>
              <Input
                id="prj-build"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-dist">Папка сборки</Label>
              <Input
                id="prj-dist"
                value={buildDir}
                onChange={(e) => setBuildDir(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
              {error}
            </p>
          )}

          <DialogFooter className="mt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy || !name}>
              {busy ? "Сохраняю…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
