import { Check, PackageSearch, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DiscoveredApp, ServerRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

interface Props {
  /** Сервер, на котором ищем приложения; null — диалог закрыт */
  server: ServerRecord | null;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  onClose: () => void;
  /** Проект добавлен — родитель обновляет список */
  onImported: () => void;
}

export function DiscoverAppsDialog({ server, askPassword, onClose, onImported }: Props) {
  const { t } = useI18n();
  const [apps, setApps] = useState<DiscoveredApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Пароль со скана: импорт тоже ходит на сервер (переносит env-файлы приложения)
  const [password, setPassword] = useState<string | undefined>(undefined);

  // Grows on every scan and server change/close — a late response of a stale
  // scan is ignored. The dialog is mounted permanently, so the invalidation
  // lives in the effect on serverId, not in unmount
  const sessionRef = useRef(0);

  async function scan(target: ServerRecord) {
    const session = ++sessionRef.current;
    setApps(null);
    setError(null);
    const password = await passwordFor(target, askPassword);
    if (sessionRef.current !== session) return;
    if (password === null) {
      onClose();
      return;
    }
    setPassword(password);
    setLoading(true);
    const result = await window.plantar.discoverApps(target.id, password);
    if (sessionRef.current !== session) return;
    setLoading(false);
    if (result.ok) setApps(result.data);
    else setError(result.error);
  }

  const serverId = server?.id;
  useEffect(() => {
    sessionRef.current++;
    setApps(null);
    setError(null);
    setLoading(false);
    if (server) void scan(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  return (
    <Dialog open={server !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("discover.title")}</DialogTitle>
          <DialogDescription>
            {server ? t("discover.description", { server: server.name }) : ""}
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-lg bg-moss/10 px-3 py-2 text-[12.5px] leading-snug text-moss">
          {t("discover.hint")}
        </p>

        {error && (
          <div className="flex flex-col gap-2">
            <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => server && void scan(server)}
            >
              <RefreshCw />
              {t("discover.retry")}
            </Button>
          </div>
        )}

        {loading && <p className="text-[13px] text-ink-soft">{t("discover.scanning")}</p>}

        {apps !== null && apps.length === 0 && (
          <div className="py-4 text-center">
            <PackageSearch className="mx-auto size-8 text-sage" />
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
              {t("discover.empty")}
            </p>
          </div>
        )}

        {apps !== null && apps.length > 0 && (
          <div className="thin-scroll flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {apps.map((app) =>
              server ? (
                <DiscoveredAppCard
                  key={app.pm2Name}
                  app={app}
                  serverId={server.id}
                  password={password}
                  onImported={onImported}
                />
              ) : null,
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const IMPORT_TYPES = ["node", "next", "bot"] as const;
type ImportType = (typeof IMPORT_TYPES)[number];

function DiscoveredAppCard({
  app,
  serverId,
  password,
  onImported,
}: {
  app: DiscoveredApp;
  serverId: string;
  password?: string;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(app.suggestedName);
  const [type, setType] = useState<ImportType>(app.suggestedType);
  const [domain, setDomain] = useState(app.domain ?? "");
  const [port, setPort] = useState(app.port ? String(app.port) : "");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeLabels: Record<ImportType, string> = {
    node: t("projectSettings.typeNodeLabel"),
    next: t("projectSettings.typeNextLabel"),
    bot: t("projectSettings.typeBotLabel"),
  };
  const online = app.status === "online";

  async function add() {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      setError(t("projectSettings.nameError"));
      return;
    }
    const portValue = port.trim() ? Number(port.trim()) : undefined;
    if (
      port.trim() &&
      (!/^\d+$/.test(port.trim()) || portValue! < 1 || portValue! > 65535)
    ) {
      setError(t("projectSettings.portError"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await window.plantar.importProject({
      serverId,
      password,
      config: {
        name,
        type,
        runtime: app.runtime,
        domain: type === "bot" ? undefined : domain.trim() || undefined,
        port: type === "bot" ? undefined : portValue,
      },
      pm2Name: app.pm2Name,
      appDir: app.appDir,
      nginxConfFile: app.nginxConfFile,
      outLogPath: app.outLogPath,
      errLogPath: app.errLogPath,
      accessLogPath: app.accessLogPath,
      errorLogPath: app.errorLogPath,
      repoUrl: app.repoUrl,
      branch: app.branch,
      repoSubdir: app.repoSubdir,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAdded(true);
    onImported();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-[13px] font-bold">
          {app.pm2Name}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            online ? "bg-moss/10 text-moss" : "bg-clay/10 text-clay",
          )}
        >
          {online ? t("discover.statusOnline") : t("discover.statusStopped")}
        </span>
        {added ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-moss">
            <Check className="size-3.5" />
            {t("discover.added")}
          </span>
        ) : (
          <Button
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => void add()}
            disabled={busy || !name}
          >
            {busy ? t("discover.adding") : t("discover.add")}
          </Button>
        )}
      </div>

      <p className="truncate font-mono text-[12px] text-ink-soft" title={app.appDir}>
        {t("discover.serverFolder")}: {app.appDir || "—"}
      </p>
      {app.envFiles.length > 0 && (
        <p
          className="truncate font-mono text-[12px] text-ink-soft"
          title={app.envFiles.join(", ")}
        >
          {t("discover.envFiles")}: {app.envFiles.join(", ")}
        </p>
      )}
      {app.repoUrl && (
        <p className="truncate font-mono text-[12px] text-ink-soft" title={app.repoUrl}>
          {t("discover.repo")}: {app.repoUrl}
          {app.branch ? ` · ${app.branch}` : ""}
          {app.repoSubdir ? ` · /${app.repoSubdir}` : ""}
        </p>
      )}

      {!added && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`disc-name-${app.pm2Name}`}>{t("projectSettings.name")}</Label>
            <Input
              id={`disc-name-${app.pm2Name}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`disc-type-${app.pm2Name}`}>{t("projectSettings.type")}</Label>
            <Select
              id={`disc-type-${app.pm2Name}`}
              value={type}
              onChange={(e) => setType(e.target.value as ImportType)}
            >
              {IMPORT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {typeLabels[value]}
                </option>
              ))}
            </Select>
          </div>
          {type !== "bot" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`disc-domain-${app.pm2Name}`}>
                {t("projectSettings.domain")}
              </Label>
              <Input
                id={`disc-domain-${app.pm2Name}`}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={t("projectSettings.domainPlaceholder")}
              />
            </div>
          )}
          {type !== "bot" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`disc-port-${app.pm2Name}`}>{t("projectSettings.port")}</Label>
              <Input
                id={`disc-port-${app.pm2Name}`}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                inputMode="numeric"
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}
    </div>
  );
}
