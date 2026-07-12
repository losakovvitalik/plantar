import { ArrowRight, RefreshCw, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Pm2ProcessHealth,
  ProjectConfig,
  ProjectRecord,
  ServerRecord,
  TrafficStats,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
} from "./ui/chart";

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  config: ProjectConfig | null;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  /** Переход на экран сервера — там ставится инструмент статистики */
  onOpenServer: () => void;
  /** Переключает на вкладку «Деплой» и сразу запускает деплой */
  onDeploy: () => void;
}

const CHART_GREEN = "var(--color-chart-1)";
const CHART_AMBER = "var(--color-chart-2)";

/** Снимок вкладки: здоровье процесса + посещаемость (что применимо к типу) */
interface Snapshot {
  /** undefined — тип без процесса (static); null — процесс на сервере не найден */
  health?: Pm2ProcessHealth | null;
  /** undefined — тип без сайта (bot) или не установлен GoAccess */
  traffic?: TrafficStats;
  goaccessMissing: boolean;
}

export function AppStatusTab({
  project,
  server,
  config,
  askPassword,
  onOpenServer,
  onDeploy,
}: Props) {
  const { t, lang } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = config?.type;

  const load = useCallback(
    async (password?: string) => {
      if (!type) return;
      setLoading(true);
      setError(null);
      try {
        const next: Snapshot = { goaccessMissing: false };
        if (type !== "static") {
          const health = await window.plantar.getAppHealth(project.id, password);
          if (!health.ok) throw new Error(health.error);
          next.health = health.data;
        }
        if (type !== "bot") {
          // Пароль нужен только первому запросу — дальше соединение живёт в пуле
          const monitoring = await window.plantar.getMonitoringStatus(server.id, password);
          if (!monitoring.ok) throw new Error(monitoring.error);
          if (monitoring.data.goaccess === null) {
            next.goaccessMissing = true;
          } else {
            const traffic = await window.plantar.getTrafficStats(project.id);
            if (!traffic.ok) throw new Error(traffic.error);
            next.traffic = traffic.data;
          }
        }
        setSnapshot(next);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [project.id, server.id, type],
  );

  // Без запроса пароля (ключ или живое соединение) — загружаем сразу, иначе по кнопке
  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (!type) return;
    void canConnectSilently(server).then((ok) => {
      if (ok) void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, type, load]);

  async function refresh() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    await load(password);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-4 thin-scroll">
      <div className="flex shrink-0 items-center gap-3">
        <Button onClick={refresh} disabled={loading || !type} variant="outline" size="sm">
          <RefreshCw className={cn(loading && "animate-spin")} />
          {loading ? t("appStatus.checking") : t("appStatus.check")}
        </Button>
      </div>

      {error && (
        <p className="shrink-0 rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {snapshot && (
        <div className="flex flex-col gap-4">
          {type === "static" ? (
            <p className="rounded-xl border border-line bg-card px-5 py-4 text-[13px] leading-relaxed text-ink-soft">
              {t("appStatus.staticNote")}
            </p>
          ) : (
            <HealthCard health={snapshot.health ?? null} />
          )}

          {type !== "bot" &&
            (snapshot.goaccessMissing ? (
              <div className="rounded-xl border border-line bg-card p-5">
                <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
                  {t("appStatus.trafficTitle")}
                </h3>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-soft">
                  {t("appStatus.needGoaccess")}
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={onOpenServer}>
                  {t("appStatus.openServer")}
                  <ArrowRight />
                </Button>
              </div>
            ) : (
              snapshot.traffic && (
                <TrafficCard traffic={snapshot.traffic} lang={lang} onDeploy={onDeploy} />
              )
            ))}
        </div>
      )}
    </div>
  );
}

/** Карточка здоровья pm2-процесса: состояние, время работы, перезапуски, нагрузка */
function HealthCard({ health }: { health: Pm2ProcessHealth | null }) {
  const { t, lang } = useI18n();

  if (!health) {
    return (
      <p className="rounded-xl border border-line bg-card px-5 py-4 text-[13px] leading-relaxed text-ink-soft">
        {t("appStatus.noProcess")}
      </p>
    );
  }

  const running = health.status === "online" || health.status === "launching";
  const state = running ? "running" : health.status === "errored" ? "errored" : "stopped";
  const badge = {
    running: {
      className: "bg-moss/10 text-moss",
      label: t("appStatus.state.running"),
    },
    errored: { className: "bg-clay/10 text-clay", label: t("appStatus.state.errored") },
    stopped: {
      className: "bg-line/60 text-ink-soft",
      label: t("appStatus.state.stopped"),
    },
  }[state];

  const startedAt = health.startedAt
    ? new Date(health.startedAt).toLocaleString(lang, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center gap-2.5">
        <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
          {t("appStatus.processTitle")}
        </h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        {startedAt && <HealthFact label={t("appStatus.since")} value={startedAt} />}
        {health.restarts !== undefined && (
          <HealthFact
            label={t("appStatus.restarts")}
            value={String(health.restarts)}
            hint={health.restarts > 0 ? t("appStatus.restartsHint") : undefined}
          />
        )}
        {health.memoryMb !== undefined && (
          <HealthFact
            label={t("appStatus.memory")}
            value={t("appStatus.mb", { mb: health.memoryMb })}
          />
        )}
        {health.cpuPercent !== undefined && (
          <HealthFact label={t("appStatus.cpu")} value={`${health.cpuPercent}%`} />
        )}
      </div>
    </div>
  );
}

function HealthFact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-[11.5px] text-ink-soft">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** Посещаемость: итоги, график по дням, по часам и популярные страницы */
function TrafficCard({
  traffic,
  lang,
  onDeploy,
}: {
  traffic: TrafficStats;
  lang: string;
  onDeploy: () => void;
}) {
  const { t } = useI18n();

  // «Журнала нет» и «журнал пока пуст» — разные ситуации: без своего журнала
  // посещения не появятся, сколько сайт ни открывай
  if (traffic.logMissing || traffic.totalHits === 0) {
    return (
      <div className="rounded-xl border border-line bg-card p-5">
        <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
          {t("appStatus.trafficTitle")}
        </h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-soft">
          {traffic.logMissing
            ? t("appStatus.trafficNoLog")
            : t("appStatus.trafficEmpty")}
        </p>
        {traffic.logMissing && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onDeploy}>
            <Rocket />
            {t("deploy.start")}
          </Button>
        )}
      </div>
    );
  }

  const errors5xx = traffic.statusCodes
    .filter((code) => code.family === "5xx")
    .reduce((sum, code) => sum + code.hits, 0);

  const day = (date: string) =>
    new Date(date).toLocaleDateString(lang, { day: "numeric", month: "short" });

  const byDayConfig: ChartConfig = {
    hits: { label: t("appStatus.requests"), color: CHART_GREEN },
    visitors: { label: t("appStatus.visitors"), color: CHART_AMBER },
  };
  const byHourConfig: ChartConfig = {
    hits: { label: t("appStatus.requests"), color: CHART_GREEN },
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
            {t("appStatus.trafficTitle")}
          </h3>
          <span className="text-[11.5px] text-ink-soft">{t("appStatus.trafficHint")}</span>
        </div>

        <div className="mt-4 flex gap-8">
          <Stat label={t("appStatus.requests")} value={traffic.totalHits} lang={lang} />
          <Stat label={t("appStatus.visitors")} value={traffic.totalVisitors} lang={lang} />
          <Stat
            label={t("appStatus.errors")}
            value={errors5xx}
            lang={lang}
            alert={errors5xx > 0}
          />
        </div>

        {traffic.byDay.length > 1 && (
          <>
            <div className="mt-5 flex items-center justify-between">
              <h4 className="text-[12.5px] font-semibold">{t("appStatus.byDay")}</h4>
              <ChartLegend config={byDayConfig} />
            </div>
            <ChartContainer config={byDayConfig} className="mt-2">
              <LineChart data={traffic.byDay} margin={{ top: 4, right: 8, left: -16 }}>
                <CartesianGrid vertical={false} strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  tickFormatter={day}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={(v) => day(String(v))} />}
                />
                <Line
                  dataKey="hits"
                  stroke="var(--color-hits)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="visitors"
                  stroke="var(--color-visitors)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </>
        )}

        <h4 className="mt-5 text-[12.5px] font-semibold">{t("appStatus.byHour")}</h4>
        <ChartContainer config={byHourConfig} className="mt-2 h-36">
          <BarChart data={traffic.byHour} margin={{ top: 4, right: 8, left: -16 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="hour"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              ticks={[0, 6, 12, 18, 23]}
            />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={(v) => `${v}:00`} />}
            />
            <Bar
              dataKey="hits"
              fill="var(--color-hits)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </div>

      {traffic.topPaths.length > 0 && (
        <div className="rounded-xl border border-line bg-card p-5">
          <h3 className="text-[13px] font-bold tracking-wide text-ink-soft uppercase">
            {t("appStatus.topPaths")}
          </h3>
          <ul className="mt-3 flex flex-col gap-1.5">
            {traffic.topPaths.map((item) => (
              <li key={item.path} className="flex items-baseline gap-3 text-[12.5px]">
                <span className="min-w-0 truncate font-mono">{item.path}</span>
                <span className="ml-auto shrink-0 font-semibold tabular-nums">
                  {item.hits.toLocaleString(lang)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  lang,
  alert,
}: {
  label: string;
  value: number;
  lang: string;
  alert?: boolean;
}) {
  return (
    <div>
      <p className="text-[11.5px] text-ink-soft">{label}</p>
      <p className={cn("mt-0.5 text-[19px] font-bold", alert && "text-clay")}>
        {value.toLocaleString(lang)}
      </p>
    </div>
  );
}
