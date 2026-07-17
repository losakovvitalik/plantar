import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ServerMetricPoint } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "./ui/chart";

interface Props {
  cpu: ServerMetricPoint[];
  ram: ServerMetricPoint[];
  lang: string;
  /** Верх оси процессора; не задан — по данным (приложение может занять больше одного ядра) */
  cpuMax?: number;
  /** Верх оси памяти; не задан — по данным */
  ramMax?: number;
  /** Пояснение к графику процессора */
  cpuHint?: string;
  /** Сводка справа от заголовка памяти */
  ramSummary?: string;
}

/** Пара графиков нагрузки — процессор (%) и память (МБ); сервер и приложение */
export function MetricsCharts({
  cpu,
  ram,
  lang,
  cpuMax,
  ramMax,
  cpuHint,
  ramSummary,
}: Props) {
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
        <div className="flex items-baseline gap-2">
          <h4 className="text-[12.5px] font-semibold">{t("monitoring.cpuChart")}</h4>
          {cpuHint && <span className="text-[11.5px] text-ink-soft">{cpuHint}</span>}
        </div>
        <ChartContainer config={cpuConfig} className="mt-2 h-36">
          <AreaChart data={cpu} margin={{ top: 4, right: 8, left: -16 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={40}
              tickFormatter={time}
            />
            <YAxis tickLine={false} axisLine={false} domain={[0, cpuMax ?? "auto"]} />
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
          {ramSummary && <span className="text-[11.5px] text-ink-soft">{ramSummary}</span>}
        </div>
        <ChartContainer config={ramConfig} className="mt-2 h-36">
          <AreaChart data={ram} margin={{ top: 4, right: 8, left: -16 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={40}
              tickFormatter={time}
            />
            <YAxis tickLine={false} axisLine={false} domain={[0, ramMax ?? "auto"]} />
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

/** Переключатель окна графиков: час / сутки */
export function WindowToggle({
  value,
  onChange,
  disabled,
}: {
  value: 3600 | 86400;
  onChange: (seconds: 3600 | 86400) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      {([3600, 86400] as const).map((seconds) => (
        <button
          key={seconds}
          type="button"
          onClick={() => onChange(seconds)}
          disabled={disabled}
          className={cn(
            "rounded-md px-2.5 py-1 text-[11.5px] font-semibold",
            value === seconds ? "bg-moss/10 text-moss" : "text-ink-soft hover:bg-line/50",
          )}
        >
          {seconds === 3600 ? t("monitoring.hour") : t("monitoring.day")}
        </button>
      ))}
    </div>
  );
}
