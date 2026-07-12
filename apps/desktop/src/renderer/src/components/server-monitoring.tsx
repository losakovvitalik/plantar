import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type {
  MonitoringStatus,
  MonitoringTool,
  ServerMetrics,
  ServerRecord,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "./ui/chart";

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
            <div className="flex items-center gap-1">
              {([HOUR, DAY] as const).map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => void switchWindow(seconds)}
                  disabled={metricsLoading}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11.5px] font-semibold",
                    window_ === seconds
                      ? "bg-moss/10 text-moss"
                      : "text-ink-soft hover:bg-line/50",
                  )}
                >
                  {seconds === HOUR ? t("monitoring.hour") : t("monitoring.day")}
                </button>
              ))}
            </div>
          </div>
          {metrics && <LoadCharts metrics={metrics} lang={lang} />}
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
          </ul>
        )}
      </div>
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
}: {
  name: string;
  description: string;
  installed: boolean;
  needsStart?: boolean;
  installing: boolean;
  onInstall: () => void;
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
          {t("monitoring.installed")}
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
              : t("monitoring.install")}
        </Button>
      )}
    </li>
  );
}

/** Графики нагрузки: процессор (%) и память (МБ) за выбранное окно */
function LoadCharts({ metrics, lang }: { metrics: ServerMetrics; lang: string }) {
  const { t } = useI18n();

  const time = (seconds: number) =>
    new Date(seconds * 1000).toLocaleTimeString(lang, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const cpuConfig: ChartConfig = {
    value: { label: t("monitoring.cpuSeries"), color: "var(--color-chart-1)" },
  };
  const ramConfig: ChartConfig = {
    value: { label: t("monitoring.ramSeries"), color: "var(--color-chart-2)" },
  };

  return (
    <div className="mt-3 flex flex-col gap-4">
      <div>
        <h4 className="text-[12.5px] font-semibold">{t("monitoring.cpuChart")}</h4>
        <ChartContainer config={cpuConfig} className="mt-2 h-36">
          <AreaChart data={metrics.cpu} margin={{ top: 4, right: 8, left: -16 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={40}
              tickFormatter={time}
            />
            <YAxis tickLine={false} axisLine={false} domain={[0, 100]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => time(Number(v))}
                  valueFormatter={(v) => `${v}%`}
                />
              }
            />
            <Area
              dataKey="value"
              stroke="var(--color-value)"
              strokeWidth={2}
              fill="var(--color-value)"
              fillOpacity={0.1}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h4 className="text-[12.5px] font-semibold">{t("monitoring.ramChart")}</h4>
          {metrics.ramUsed.length > 0 && (
            <span className="text-[11.5px] text-ink-soft">
              {t("monitoring.ramSummary", {
                used: metrics.ramUsed[metrics.ramUsed.length - 1].value,
                total: metrics.ramTotalMb,
              })}
            </span>
          )}
        </div>
        <ChartContainer config={ramConfig} className="mt-2 h-36">
          <AreaChart data={metrics.ramUsed} margin={{ top: 4, right: 8, left: -16 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={40}
              tickFormatter={time}
            />
            <YAxis tickLine={false} axisLine={false} domain={[0, metrics.ramTotalMb]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => time(Number(v))}
                  valueFormatter={(v) => t("appStatus.mb", { mb: v })}
                />
              }
            />
            <Area
              dataKey="value"
              stroke="var(--color-value)"
              strokeWidth={2}
              fill="var(--color-value)"
              fillOpacity={0.1}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
