import { useEffect, useState } from "react";
import type { AppSettings } from "@plantar/storage";
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

export function SettingsDialog({ open, onOpenChange }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const result = await window.plantar.getSettings();
      if (result.ok) setSettings(result.data);
    })();
  }, [open]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    const result = await window.plantar.setSettings({
      ...settings,
      letsEncryptEmail: settings.letsEncryptEmail.trim(),
    });
    setBusy(false);
    if (result.ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription className="sr-only">Глобальные настройки Plantar</DialogDescription>
        </DialogHeader>

        {settings && (
          <div className="flex flex-col gap-6">
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
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, saveServerLogCopies: checked })
                }
              />
            </div>

            <div className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor="notify-success" className="text-[13.5px] font-semibold">
                  Уведомлять об успешных деплоях
                </Label>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                  Системное уведомление, когда деплой завершился успешно. Об ошибках
                  уведомления приходят всегда.
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
                value={settings.letsEncryptEmail}
                onChange={(e) => setSettings({ ...settings, letsEncryptEmail: e.target.value })}
                className="max-w-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={busy || !settings}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
