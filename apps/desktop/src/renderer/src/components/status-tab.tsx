import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ServerInfo, ServerRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface Props {
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

export function StatusTab({ server, askPassword }: Props) {
  const { t } = useI18n();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (password?: string) => {
      setLoading(true);
      setError(null);
      const result = await window.plantar.getServerInfo(server.id, password);
      setLoading(false);
      if (result.ok) {
        setInfo(result.data);
      } else {
        setError(result.error);
      }
    },
    [server.id],
  );

  // Без запроса пароля (ключ или живое соединение) — проверяем сразу, иначе по кнопке
  useEffect(() => {
    setInfo(null);
    setError(null);
    void canConnectSilently(server).then((ok) => {
      if (ok) void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.auth, load]);

  async function refresh() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    await load(password);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={refresh} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={cn(loading && "animate-spin")} />
          {loading ? t("status.checking") : t("status.check")}
        </Button>
        <span className="font-mono text-[12.5px] text-ink-soft">
          {server.user}@{server.host}:{server.port}
        </span>
      </div>

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {info && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-card p-5">
            <div className="flex items-center gap-2.5">
              <h3 className="text-[15px] font-bold">{info.os.pretty}</h3>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
                  info.supported ? "bg-moss/10 text-moss" : "bg-clay/10 text-clay",
                )}
              >
                {info.supported ? t("status.supported") : t("status.unsupported")}
              </span>
            </div>
            <div className="mt-3 flex gap-6 font-mono text-[13px] text-ink-soft">
              <span>{t("status.cpu", { count: info.cpuCores })}</span>
              <span>{t("status.ram", { mb: info.memoryTotalMb })}</span>
              <span>{t("status.disk", { gb: info.diskFreeRootGb })}</span>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card p-5">
            <h3 className="mb-3 text-[13px] font-bold tracking-wide text-ink-soft uppercase">
              {t("status.tools")}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {Object.entries(info.tools).map(([tool, version]) => (
                <li key={tool} className="flex items-center gap-2.5 text-[13px]">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      version ? "bg-moss" : "bg-line",
                    )}
                  />
                  <span className="w-16 font-semibold">{tool}</span>
                  <span className="truncate font-mono text-[12.5px] text-ink-soft">
                    {version ?? t("status.notInstalled")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
