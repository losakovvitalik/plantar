import { useState } from "react";
import type { ServerRecord } from "../../../preload/index.d";
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
import { RadioCard, RadioGroup } from "./ui/radio-group";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (server: ServerRecord) => void;
}

export function AddServerDialog({ open, onOpenChange, onAdded }: Props) {
  const { t } = useI18n();
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
          <DialogTitle>{t("addServer.title")}</DialogTitle>
          <DialogDescription>{t("addServer.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-host">{t("addServer.host")}</Label>
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
              <Label htmlFor="srv-port">{t("addServer.port")}</Label>
              <Input id="srv-port" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-user">{t("addServer.user")}</Label>
              <Input id="srv-user" value={user} onChange={(e) => setUser(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="srv-name">{t("addServer.name")}</Label>
              <Input
                id="srv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("addServer.namePlaceholder")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("addServer.authMethod")}</Label>
            <RadioGroup
              value={auth}
              onValueChange={(v) => setAuth(v as "key" | "password")}
              className="grid grid-cols-2 gap-2"
            >
              <RadioCard
                value="key"
                title={t("addServer.keyTitle")}
                description={t("addServer.keyDescription")}
              />
              <RadioCard
                value="password"
                title={t("addServer.passwordTitle")}
                description={t("addServer.passwordDescription")}
              />
            </RadioGroup>
          </div>

          {auth === "key" ? (
            <p className="rounded-lg bg-moss/8 px-3 py-2 text-[12.5px] leading-snug text-moss-deep">
              {t("addServer.keyNote")}
            </p>
          ) : (
            <p className="rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-amber">
              {t("addServer.passwordNote")}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="srv-password">
              {auth === "key"
                ? t("addServer.serverPasswordOnce")
                : t("addServer.serverPassword")}
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
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !host || !user || !password}>
              {busy ? t("common.connecting") : t("addServer.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
