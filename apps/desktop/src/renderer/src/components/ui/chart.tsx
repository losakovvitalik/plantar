import { type CSSProperties, type ReactElement, type ReactNode, createContext, useContext } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../lib/utils";

/** Конфиг графика в стиле shadcn: ключ серии → подпись и цвет */
export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

/**
 * Обёртка recharts-графика: задаёт размеры, цвета серий через CSS-переменные
 * --color-<ключ> и приглушённые оси/сетку в палитре приложения.
 */
export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: ReactElement;
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]),
  ) as CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        style={style}
        className={cn(
          "h-44 w-full text-[11px]",
          "[&_.recharts-cartesian-axis-tick_text]:fill-ink-soft",
          "[&_.recharts-cartesian-grid_line]:stroke-line",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-line",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-ink/5",
          className,
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Tooltip;

interface TooltipItem {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
  color?: string;
}

/** Содержимое всплывающей подсказки: цветная метка серии, подпись, значение */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  labelFormatter?: (label: string | number) => ReactNode;
  valueFormatter?: (value: number) => string;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] shadow-md">
      {label !== undefined && (
        <p className="mb-1 font-semibold">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {payload.map((item) => (
          <div key={String(item.dataKey)} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: item.color }}
            />
            <span className="text-ink-soft">
              {config[String(item.dataKey)]?.label ?? item.name}
            </span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">
              {valueFormatter && typeof item.value === "number"
                ? valueFormatter(item.value)
                : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Легенда серий: цветная метка + подпись; для двух и более серий обязательна */
export function ChartLegend({ config }: { config: ChartConfig }) {
  return (
    <div className="flex items-center gap-4">
      {Object.entries(config).map(([key, item]) => (
        <span key={key} className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
          <span className="size-2 rounded-[2px]" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
