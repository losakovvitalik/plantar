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
import { NodeLogo, ReactLogo } from "./tech-logos";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

type ProjectType = "static" | "node";

const PROJECT_TYPES: Array<{
  value: ProjectType;
  label: string;
  hint: string;
  Logo: (props: { className?: string }) => React.JSX.Element;
}> = [
  {
    value: "static",
    label: "React",
    hint: "Статический сайт: React, Vite и другие",
    Logo: ReactLogo,
  },
  {
    value: "node",
    label: "Node.js",
    hint: "Серверное приложение: Express и другие",
    Logo: NodeLogo,
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
  /** Возвращает текст ошибки или null при успехе */
  onSubmit: (config: ProjectConfigInput) => Promise<string | null>;
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
}: Props) {
  const [type, setType] = useState<ProjectType>("static");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [packageManager, setPackageManager] =
    useState<ProjectConfigInput["packageManager"]>("npm");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [buildDir, setBuildDir] = useState("dist");
  const [startCommand, setStartCommand] = useState("");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setType(initial.type ?? "static");
      setName(initial.name ?? "");
      setDomain(initial.domain ?? "");
      setPackageManager(initial.packageManager ?? "npm");
      setBuildCommand(initial.buildCommand ?? "npm run build");
      setBuildDir(initial.buildDir ?? "dist");
      setStartCommand(initial.startCommand ?? "");
      setPort(initial.port ? String(initial.port) : "");
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
    const portValue = port.trim() ? Number(port.trim()) : undefined;
    if (port.trim() && (!/^\d+$/.test(port.trim()) || portValue! < 1 || portValue! > 65535)) {
      setError("Порт: целое число от 1 до 65535.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit({
      // Порт статики диалог не редактирует — сохраняем как есть
      port: type === "node" ? portValue : initial.port,
      type,
      name,
      packageManager,
      buildCommand: buildCommand.trim() || undefined,
      buildDir: buildDir.trim() || undefined,
      startCommand: startCommand.trim() || undefined,
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
          {note && (
            <p className="rounded-lg bg-moss/10 px-3 py-2 text-[12.5px] leading-snug text-moss">
              {note}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Тип проекта</Label>
            <div className="grid grid-cols-2 gap-3">
              {PROJECT_TYPES.map(({ value, label, hint, Logo }) => (
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
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-[11.5px] leading-snug text-ink-soft">
                      {hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

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
              Строчные латинские буквы, цифры и дефис. Так будет называться
              папка сайта на сервере.
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
              С доменом сайт получит HTTPS-сертификат автоматически. Если
              оставить пустым, сайт будет открываться по IP сервера.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-pm">Менеджер пакетов</Label>
              <select
                id="prj-pm"
                value={packageManager}
                onChange={(e) =>
                  setPackageManager(
                    e.target.value as ProjectConfigInput["packageManager"],
                  )
                }
                className="border-input focus-visible:border-ring/60 focus-visible:ring-ring/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2"
              >
                {PACKAGE_MANAGERS.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>
            {type === "static" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prj-dist">Папка сборки</Label>
                <Input
                  id="prj-dist"
                  value={buildDir}
                  onChange={(e) => setBuildDir(e.target.value)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prj-port">Порт</Label>
                <Input
                  id="prj-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="автоматически"
                  inputMode="numeric"
                />
              </div>
            )}
          </div>

          {type === "static" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-build">Команда сборки</Label>
              <Input
                id="prj-build"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
              />
              <p className="text-[12px] leading-snug text-ink-soft/80">
                Выполняется в папке проекта перед деплоем. Сюда можно вписать
                любую команду и флаги, например{" "}
                <span className="font-mono">
                  npm run build -- --mode staging
                </span>
                .
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prj-start">Команда запуска</Label>
              <Input
                id="prj-start"
                value={startCommand}
                onChange={(e) => setStartCommand(e.target.value)}
                placeholder={`${packageManager} start`}
              />
              <p className="text-[12px] leading-snug text-ink-soft/80">
                Так приложение запускается на сервере (через pm2). Порт
                передаётся приложению в переменной{" "}
                <span className="font-mono">PORT</span>; если поле «Порт»
                пустое, свободный порт подберётся при первом деплое.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
              {error}
            </p>
          )}

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
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
