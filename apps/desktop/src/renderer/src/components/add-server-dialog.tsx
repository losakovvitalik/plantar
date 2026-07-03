import { useState } from "react";
import type { ServerRecord } from "../../../preload/index.d";
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
import { RadioCard, RadioGroup } from "./ui/radio-group";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (server: ServerRecord) => void;
}

export function AddServerDialog({ open, onOpenChange, onAdded }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("root");
  const [auth, setAuth] = useState<"key" | "password">("key");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await window.plantar.addServer({
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      user: user.trim(),
      auth,
      password,
    });
    setBusy(false);
    if (result.ok) {
      setName("");
      setHost("");
      setPort("22");
      setUser("root");
      setPassword("");
      onOpenChange(false);
      onAdded(result.data);
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить сервер</DialogTitle>
          <DialogDescription>
            Понадобятся адрес сервера и данные для входа — их выдаёт хостинг.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-host">Адрес (IP)</Label>
              <Input
                id="srv-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="185.42.10.7"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-port">Порт</Label>
              <Input id="srv-port" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-user">Пользователь</Label>
              <Input id="srv-user" value={user} onChange={(e) => setUser(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-name">Название (необязательно)</Label>
              <Input
                id="srv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Мой сервер"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Способ входа</Label>
            <RadioGroup
              value={auth}
              onValueChange={(v) => setAuth(v as "key" | "password")}
              className="grid grid-cols-2 gap-2"
            >
              <RadioCard
                value="key"
                title="SSH-ключ"
                description="Plantar создаст ключ и настроит его на сервере сам. Рекомендуем."
              />
              <RadioCard
                value="password"
                title="Пароль"
                description="Без ключа. Пароль будет запрашиваться при каждом подключении."
              />
            </RadioGroup>
          </div>

          {auth === "key" ? (
            <p className="rounded-lg bg-moss/8 px-3 py-2 text-[12.5px] leading-snug text-moss-deep">
              Пароль нужен один раз — чтобы установить ключ на сервер. Plantar его не сохраняет.
            </p>
          ) : (
            <p className="rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-amber">
              Пароль нигде не сохраняется. Его придётся вводить при каждом подключении к серверу.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="srv-password">
              {auth === "key" ? "Пароль сервера (нужен один раз)" : "Пароль сервера"}
            </Label>
            <Input
              id="srv-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
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
            <Button type="submit" disabled={busy || !host || !user || !password}>
              {busy ? "Подключаюсь…" : "Добавить сервер"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
