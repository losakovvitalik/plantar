import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  MonitoringStatus,
  MonitoringTool,
  ServerMetrics,
  ServerRecord,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { EnableAppMetricsDialog } from "./enable-app-metrics-dialog";
import { MetricsCharts, WindowToggle } from "./metrics-charts";
import { Button } from "./ui/button";

interface Props {
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

const HOUR = 3600;
const DAY = 86400;

/**
 * Мониторинг на экране сервера: графики нагрузки (если установлен Netdata)
 * и карточка установки инструментов — пользователь сам выбирает, что включить.
 */
export function ServerMonitoring({ server, askPassword }: Props) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<MonitoringTool | null>(null);
  const [appMetricsDialog, setAppMetricsDialog] = useState(false);
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [window_, setWindow] = useState<typeof HOUR | typeof DAY>(HOUR);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(
    async (seconds: number, password?: string) => {
      setMetricsLoading(true);
      const result = await window.plantar.getServerMetrics(server.id, seconds, password);
      setMetricsLoading(false);
      if (result.ok) setMetrics(result.data);
      else setError(result.error);
    },
    [server.id],
  );

  const load = useCallback(
    async (password?: string) => {
      setLoading(true);
      setError(null);
      const result = await window.plantar.getMonitoringStatus(server.id, password);
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.data);
      if (result.data.netdata !== null && !result.data.netdataDown) {
        await loadMetrics(HOUR);
      }
    },
    [server.id, loadMetrics],
  );

  // Без запроса пароля (ключ или живое соединение) — проверяем сразу, иначе по кнопке
  useEffect(() => {
    setStatus(null);
    setMetrics(null);
    setWindow(HOUR);
    setError(null);
    void canConnectSilently(server).then((ok) => {
      if (ok) void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, load]);

  async function check() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    await load(password);
  }

  async function install(tool: MonitoringTool) {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setInstalling(tool);
    setError(null);
    const result = await window.plantar.installMonitoringTool(server.id, tool, password);
    setInstalling(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  async function switchWindow(seconds: typeof HOUR | typeof DAY) {
    setWindow(seconds);
    await loadMetrics(seconds);
  }

  const netdataActive =
    status !== null && status.netdata !== null && !status.netdataDown;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {status && netdataActive && (
        <div className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
              {t("monitoring.loadTitle")}
            </h3>
            <WindowToggle
              value={window_}
              onChange={(seconds) => void switchWindow(seconds)}
              disabled={metricsLoading}
            />
          </div>
          {metrics && (
            <MetricsCharts
              cpu={metrics.cpu}
              ram={metrics.ramUsed}
              lang={lang}
              cpuMax={100}
              ramMax={metrics.ramTotalMb}
              apps={metrics.apps}
              ramSummary={
                metrics.ramUsed.length > 0
                  ? t("monitoring.ramSummary", {
                      used: metrics.ramUsed[metrics.ramUsed.length - 1].value,
                      total: metrics.ramTotalMb,
                    })
                  : undefined
              }
              disk={metrics.diskUsedGb}
              diskMax={metrics.diskTotalGb || undefined}
              diskSummary={
                metrics.diskUsedGb.length > 0 && metrics.diskTotalGb > 0
                  ? t("monitoring.diskSummary", {
                      // всегда одна десятичная: «23.0», а не «23»
                      used: metrics.diskUsedGb[
                        metrics.diskUsedGb.length - 1
                      ].value.toFixed(1),
                      total: metrics.diskTotalGb.toFixed(1),
                    })
                  : undefined
              }
            />
          )}
          {!metrics && metricsLoading && (
            <p className="mt-3 text-[12.5px] text-ink-soft">{t("common.loading")}</p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-line bg-card p-5">
        <div className="flex items-center gap-3">
          <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
            {t("monitoring.title")}
          </h3>
          {!status && (
            <Button
              onClick={check}
              disabled={loading}
              variant="outline"
              size="sm"
              className="ml-auto"
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
              {loading ? t("appStatus.checking") : t("monitoring.check")}
            </Button>
          )}
        </div>
        <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-ink-soft">
          {t("monitoring.description")}
        </p>

        {status && (
          <ul className="mt-4 flex flex-col gap-4">
            <ToolRow
              name={t("monitoring.goaccessName")}
              description={t("monitoring.goaccessDescription")}
              installed={status.goaccess !== null}
              installing={installing === "goaccess"}
              onInstall={() => void install("goaccess")}
            />
            <ToolRow
              name={t("monitoring.netdataName")}
              description={t("monitoring.netdataDescription")}
              installed={status.netdata !== null}
              needsStart={status.netdataDown}
              installing={installing === "netdata"}
              onInstall={() => void install("netdata")}
            />
            <ToolRow
              name={t("monitoring.appMetricsName")}
              description={t("monitoring.appMetricsDescription")}
              installed={status.appMetrics}
              installing={false}
              onInstall={() => setAppMetricsDialog(true)}
              actionLabel={t("appMetrics.enable")}
              installedLabel={t("appMetrics.enabled")}
            />
          </ul>
        )}
      </div>

      <EnableAppMetricsDialog
        server={server}
        open={appMetricsDialog}
        onOpenChange={setAppMetricsDialog}
        askPassword={askPassword}
        onEnabled={() => load()}
      />
    </div>
  );
}

/** Строка инструмента: описание с ценой, состояние и кнопка установки */
function ToolRow({
  name,
  description,
  installed,
  needsStart,
  installing,
  onInstall,
  actionLabel,
  installedLabel,
}: {
  name: string;
  description: string;
  installed: boolean;
  needsStart?: boolean;
  installing: boolean;
  onInstall: () => void;
  /** Подписи кнопки и бейджа; по умолчанию — «Установить»/«Установлен» */
  actionLabel?: string;
  installedLabel?: string;
}) {
  const { t } = useI18n();
  const ready = installed && !needsStart;

  return (
    <li className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <span className={cn("size-2 rounded-full", ready ? "bg-moss" : "bg-line")} />
          {name}
        </p>
        <p className="mt-0.5 pl-4 text-[12.5px] leading-relaxed text-ink-soft">
          {description}
        </p>
      </div>
      {ready ? (
        <span className="shrink-0 rounded-full bg-moss/10 px-2.5 py-0.5 text-[11.5px] font-bold text-moss">
          {installedLabel ?? t("monitoring.installed")}
        </span>
      ) : (
        <Button
          onClick={onInstall}
          disabled={installing}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          <Download className={cn(installing && "animate-pulse")} />
          {installing
            ? t("monitoring.installing")
            : needsStart
              ? t("monitoring.start")
              : (actionLabel ?? t("monitoring.install"))}
        </Button>
      )}
    </li>
  );
}
