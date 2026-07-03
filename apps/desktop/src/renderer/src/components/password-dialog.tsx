import { useState } from "react";
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
  const [password, setPassword] = useState("");

  function close(value: string | null) {
    setPassword("");
    onSubmit(value);
  }

  return (
    <Dialog open={serverName !== null} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Пароль для «{serverName}»</DialogTitle>
          <DialogDescription>
            Этот сервер добавлен без ключа, поэтому пароль нужен при каждом подключении.
          </DialogDescription>
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
              Отмена
            </Button>
            <Button type="submit" disabled={!password}>
              Подключиться
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
