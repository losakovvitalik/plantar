import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ServerAppUsage, ServerMetricPoint } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
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
  /** Разбивка по приложениям: вместо одного ряда — стек «приложения + другое» */
  apps?: ServerAppUsage[];
}

/** Крупнейших приложений в стеке; остальные вместе с системой уходят в «Другое» */
const MAX_STACK_APPS = 4;

/** Цвета рядов стека: порядок 1 → 3 → 2 → 4 проверен dataviz-валидатором
    (соседние ряды различимы при цветослепоте, контраст с карточкой ≥ 3:1) */
const STACK_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-2)",
  "var(--color-chart-4)",
];

/** Топ приложений по доле от ресурсов сервера. Общий для обоих графиков,
    чтобы приложение было одного цвета на процессоре и на памяти */
function topApps(apps: ServerAppUsage[], ramTotalMb: number): ServerAppUsage[] {
  const average = (points: ServerMetricPoint[]) =>
    points.length > 0
      ? points.reduce((sum, point) => sum + point.value, 0) / points.length
      : 0;
  const share = (app: ServerAppUsage) =>
    Math.max(
      average(app.cpu) / 100,
      ramTotalMb > 0 ? average(app.memMb) / ramTotalMb : 0,
    );
  return [...apps].sort((a, b) => share(b) - share(a)).slice(0, MAX_STACK_APPS);
}

/** Строки стека: время, ряды приложений и «Другое» — остаток от общего ряда */
function stackRows(
  total: ServerMetricPoint[],
  series: Array<{ key: string; points: ServerMetricPoint[] }>,
  decimals: number,
): Array<Record<string, number>> {
  const factor = 10 ** decimals;
  const rows = new Map<number, Record<string, number>>();
  for (const point of total) {
    const row: Record<string, number> = { time: point.time, other: point.value };
    for (const s of series) row[s.key] = 0;
    rows.set(point.time, row);
  }
  for (const s of series) {
    for (const point of s.points) {
      const row = rows.get(point.time);
      if (!row) continue;
      row[s.key] = point.value;
      row.other -= point.value;
    }
  }
  // Суммы замеров чуть расходятся с общим рядом — остаток не бывает меньше нуля
  for (const row of rows.values()) {
    row.other = Math.max(0, Math.round(row.other * factor) / factor);
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
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
  apps,
}: Props) {
  const { t } = useI18n();

  const time = (seconds: number) =>
    new Date(seconds * 1000).toLocaleTimeString(lang, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const stack = apps && apps.length > 0 ? topApps(apps, ramMax ?? 0) : [];
  const stacked = stack.length > 0;
  const stackKeys = [...stack.map((_, i) => `app${i}`), "other"];

  const stackConfig: ChartConfig = Object.fromEntries([
    ...stack.map((app, i) => [`app${i}`, { label: app.name, color: STACK_COLORS[i] }]),
    ["other", { label: t("monitoring.otherSeries"), color: "var(--color-chart-other)" }],
  ]);

  const cpuConfig: ChartConfig = stacked
    ? stackConfig
    : { value: { label: t("monitoring.cpuSeries"), color: "var(--color-chart-1)" } };
  const ramConfig: ChartConfig = stacked
    ? stackConfig
    : { value: { label: t("monitoring.ramSeries"), color: "var(--color-chart-2)" } };

  const cpuData = stacked
    ? stackRows(cpu, stack.map((app, i) => ({ key: `app${i}`, points: app.cpu })), 1)
    : cpu;
  const ramData = stacked
    ? stackRows(ram, stack.map((app, i) => ({ key: `app${i}`, points: app.memMb })), 0)
    : ram;

  // Ряды стека разделены тонкой линией цвета карточки — границы видны без
  // зазоров. Рисуются в обратном порядке: стек читается сверху вниз так же,
  // как легенда слева направо, а «Другое» лежит внизу, у оси
  const areas = stacked ? (
    [...stackKeys].reverse().map((key) => (
      <Area
        key={key}
        dataKey={key}
        stackId="apps"
        stroke="var(--color-card)"
        strokeWidth={1}
        fill={`var(--color-${key})`}
        fillOpacity={0.85}
        dot={false}
        isAnimationActive={false}
      />
    ))
  ) : (
    <Area
      dataKey="value"
      stroke="var(--color-value)"
      strokeWidth={2}
      fill="var(--color-value)"
      fillOpacity={0.1}
      dot={false}
      isAnimationActive={false}
    />
  );

  return (
    <div className="mt-3 flex flex-col gap-4">
      {stacked && (
        <div>
          <ChartLegend config={stackConfig} />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-soft">
            {t("monitoring.breakdownHint")}
          </p>
        </div>
      )}
      <div>
        <div className="flex items-baseline gap-2">
          <h4 className="text-[12.5px] font-semibold">{t("monitoring.cpuChart")}</h4>
          {cpuHint && <span className="text-[11.5px] text-ink-soft">{cpuHint}</span>}
        </div>
        <ChartContainer config={cpuConfig} className="mt-2 h-36">
          <AreaChart data={cpuData} margin={{ top: 4, right: 8, left: -16 }}>
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
            {areas}
          </AreaChart>
        </ChartContainer>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h4 className="text-[12.5px] font-semibold">{t("monitoring.ramChart")}</h4>
          {ramSummary && <span className="text-[11.5px] text-ink-soft">{ramSummary}</span>}
        </div>
        <ChartContainer config={ramConfig} className="mt-2 h-36">
          <AreaChart data={ramData} margin={{ top: 4, right: 8, left: -16 }}>
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
            {areas}
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
