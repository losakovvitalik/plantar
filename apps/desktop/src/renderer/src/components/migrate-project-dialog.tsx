import type { ProjectRecord } from "../../../preload/index.d";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRecord;
  /** Имя проекта из настроек — под ним появятся папка и pm2-процесс */
  configName: string;
  /** Пользователь подтвердил перенос — запускается takeover-деплой */
  onConfirm: () => void;
}

/**
 * Подтверждение переноса импортированного проекта под управление Plantar.
 * Список изменений собирается из записи проекта — что реально сделает
 * takeover-деплой, то и показывается.
 */
export function MigrateProjectDialog({
  open,
  onOpenChange,
  project,
  configName,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const external = project.external;
  if (!external) return null;

  const items = [
    t("migrate.itemPath", {
      oldDir: external.appDir,
      newDir: `/var/www/${configName}/releases`,
    }),
    t("migrate.itemPm2", { name: configName, pm2Name: external.pm2Name }),
    ...(external.nginxConfFile
      ? [t("migrate.itemNginx", { file: external.nginxConfFile })]
      : []),
    t("migrate.itemEnv"),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("migrate.title")}</DialogTitle>
          <DialogDescription>{t("migrate.description")}</DialogDescription>
        </DialogHeader>

        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-soft">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <p className="rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-ink">
          {t("migrate.itemData")}
        </p>

        <p className="text-[12.5px] leading-snug text-ink-soft">
          {t("migrate.after")}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm}>{t("migrate.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
