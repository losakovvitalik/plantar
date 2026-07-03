import { useEffect, useState } from "react";
import type { AppSettings } from "@plantar/storage";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const result = await window.plantar.getSettings();
      if (result.ok) setSettings(result.data);
    })();
  }, [open]);

  async function apply(patch: Partial<AppSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const result = await window.plantar.setSettings(next);
    if (result.ok) {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <div className="flex items-baseline justify-between">
          <DialogTitle>Настройки</DialogTitle>
          <span
            className={`text-[12.5px] font-semibold text-moss transition-opacity ${savedFlash ? "opacity-100" : "opacity-0"}`}
          >
            Сохранено ✓
          </span>
        </div>
        <DialogDescription className="sr-only">Глобальные настройки Plantar</DialogDescription>

        {settings && (
          <div className="mt-2 flex flex-col gap-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="log-copies" className="text-[13.5px] font-semibold">
                  Хранить копии серверных логов
                </Label>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                  При каждом просмотре логов последняя версия сохраняется на этот компьютер —
                  они останутся доступны, даже если сервер перестанет отвечать.
                </p>
              </div>
              <Switch
                id="log-copies"
                checked={settings.saveServerLogCopies}
                onCheckedChange={(checked) => void apply({ saveServerLogCopies: checked })}
              />
            </div>

            <div>
              <Label htmlFor="le-email" className="text-[13.5px] font-semibold">
                Email для SSL-сертификатов
              </Label>
              <p className="mt-1 mb-2 text-[12.5px] leading-snug text-ink-soft">
                Let&nbsp;Encrypt пришлёт письмо, если с автопродлением сертификата что-то
                пойдёт не так. Применяется при следующем деплое с доменом. Можно оставить
                пустым.
              </p>
              <Input
                id="le-email"
                type="email"
                placeholder="you@example.com"
                defaultValue={settings.letsEncryptEmail}
                onBlur={(e) => {
                  if (e.target.value !== settings.letsEncryptEmail) {
                    void apply({ letsEncryptEmail: e.target.value.trim() });
                  }
                }}
                className="max-w-xs"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
