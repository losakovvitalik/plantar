import { useState } from "react";
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

interface Props {
  serverName: string | null;
  onSubmit: (password: string | null) => void;
}

/** Запрос пароля для серверов без ключа — перед каждым подключением */
export function PasswordDialog({ serverName, onSubmit }: Props) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");

  function close(value: string | null) {
    setPassword("");
    onSubmit(value);
  }

  return (
    <Dialog open={serverName !== null} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("password.title", { name: serverName ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("password.description")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(password);
          }}
          className="flex flex-col gap-3"
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!password}>
              {t("common.connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
