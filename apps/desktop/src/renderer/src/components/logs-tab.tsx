import { Eraser, Pause, Play, Plug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  LogStreamSource,
  ProjectConfig,
  ProjectRecord,
  ServerRecord,
} from "../../../preload/index.d";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  config: ProjectConfig | null;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

type Channel = "out" | "err";
type LogLine = { channel: Channel; text: string };
type StreamState = "idle" | "connecting" | "live" | "ended";

/** Больше строк держать в DOM нет смысла — старые вытесняются */
const MAX_LINES = 5000;

const SOURCE_LABELS: Record<LogStreamSource, string> = {
  app: "Приложение",
  nginx: "nginx",
};

/** Подписи каналов без жаргона: технически это stdout/stderr и access/error */
const CHANNEL_LABELS: Record<LogStreamSource, Record<Channel, string>> = {
  app: { out: "Вывод", err: "Ошибки" },
  nginx: { out: "Запросы", err: "Ошибки" },
};

/** Доступные источники: у статики нет pm2-процесса, у бота — nginx */
function sourcesFor(config: ProjectConfig | null): LogStreamSource[] {
  if (config?.type === "static") return ["nginx"];
  if (config?.type === "bot") return ["app"];
  return ["app", "nginx"];
}

export function LogsTab({ project, server, config, askPassword }: Props) {
  const sources = sourcesFor(config);
  const [source, setSource] = useState<LogStreamSource>(sources[0]);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<StreamState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<Channel | "all">("all");

  const streamIdRef = useRef<string | null>(null);
  // Растёт при каждом старте/остановке — ответ устаревшего запроса игнорируется
  const sessionRef = useRef(0);
  // Хвосты чанков без завершающего \n — ждут продолжения
  const partialRef = useRef<Record<Channel, string>>({ out: "", err: "" });
  const pausedRef = useRef(false);
  // Строки, пришедшие во время паузы; показываются при продолжении
  const pendingRef = useRef<LogLine[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  // Автопрокрутка активна, пока вывод не отмотан вверх вручную
  const stickRef = useRef(true);

  // Конфиг подгружается позже — источник мог стать недоступным для типа проекта
  if (!sources.includes(source)) setSource(sources[0]);

  function stopCurrent() {
    sessionRef.current++;
    if (streamIdRef.current) {
      void window.plantar.stopLogStream(streamIdRef.current);
      streamIdRef.current = null;
    }
  }

  async function begin(password?: string) {
    stopCurrent();
    const session = sessionRef.current;
    setState("connecting");
    setError(null);
    const result = await window.plantar.startLogStream(project.id, source, password);
    if (sessionRef.current !== session) {
      // Пока подключались, вкладку или источник сменили — глушим лишний стрим
      if (result.ok) void window.plantar.stopLogStream(result.data.streamId);
      return;
    }
    if (!result.ok) {
      setState("idle");
      setError(result.error);
      return;
    }
    streamIdRef.current = result.data.streamId;
    setState("live");
  }

  async function connect() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    await begin(password);
  }

  // Смена проекта или источника: сброс вывода и автостарт, если пароль не нужен
  useEffect(() => {
    setLines([]);
    setError(null);
    setState("idle");
    setPaused(false);
    pausedRef.current = false;
    pendingRef.current = [];
    partialRef.current = { out: "", err: "" };
    stickRef.current = true;
    let cancelled = false;
    void canConnectSilently(server).then((ok) => {
      if (!cancelled && ok) void begin();
    });
    return () => {
      cancelled = true;
      stopCurrent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, source]);

  useEffect(() => {
    const append = (channel: Channel, text: string) => {
      const combined = partialRef.current[channel] + text;
      const parts = combined.split("\n");
      partialRef.current[channel] = parts.pop() ?? "";
      const fresh = parts.map((t) => ({ channel, text: t.replace(/\r$/, "") }));
      if (fresh.length === 0) return;
      if (pausedRef.current) {
        pendingRef.current = [...pendingRef.current, ...fresh].slice(-MAX_LINES);
      } else {
        setLines((prev) => [...prev, ...fresh].slice(-MAX_LINES));
      }
    };

    const offData = window.plantar.onLogStreamData((event) => {
      if (event.streamId === streamIdRef.current) append(event.channel, event.text);
    });
    const offEnd = window.plantar.onLogStreamEnd((event) => {
      if (event.streamId !== streamIdRef.current) return;
      streamIdRef.current = null;
      // Поток кончился на паузе — показываем накопленное, иначе оно потеряется
      if (pendingRef.current.length > 0) {
        const pending = pendingRef.current;
        pendingRef.current = [];
        setLines((prev) => [...prev, ...pending].slice(-MAX_LINES));
      }
      pausedRef.current = false;
      setPaused(false);
      setState("ended");
    });
    return () => {
      offData();
      offEnd();
    };
  }, []);

  useEffect(() => {
    if (stickRef.current) {
      boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
    }
  }, [lines]);

  function togglePause() {
    const next = !paused;
    if (!next && pendingRef.current.length > 0) {
      const pending = pendingRef.current;
      pendingRef.current = [];
      setLines((prev) => [...prev, ...pending].slice(-MAX_LINES));
    }
    pausedRef.current = next;
    setPaused(next);
  }

  function clear() {
    pendingRef.current = [];
    setLines([]);
  }

  const visibleLines = filter === "all" ? lines : lines.filter((l) => l.channel === filter);
  const channelLabels = CHANNEL_LABELS[source];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        {sources.length > 1 && (
          <Segmented
            options={sources.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
            value={source}
            onChange={(value) => setSource(value as LogStreamSource)}
          />
        )}
        <Segmented
          options={[
            { value: "all", label: "Всё" },
            { value: "out", label: channelLabels.out },
            { value: "err", label: channelLabels.err },
          ]}
          value={filter}
          onChange={(value) => setFilter(value as Channel | "all")}
        />

        <div className="ml-auto flex items-center gap-3">
          <StreamStatus state={state} paused={paused} />
          <Button
            onClick={togglePause}
            disabled={state !== "live"}
            variant="outline"
            size="sm"
          >
            {paused ? <Play /> : <Pause />}
            {paused ? "Продолжить" : "Пауза"}
          </Button>
          <Button
            onClick={clear}
            disabled={lines.length === 0}
            variant="outline"
            size="sm"
          >
            <Eraser />
            Очистить
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {state === "idle" && !error && (
        <div className="flex items-center gap-3">
          <Button onClick={connect} variant="outline" size="sm">
            <Plug />
            Подключиться
          </Button>
          <span className="text-[13px] text-ink-soft">
            Живые логи с сервера — без терминала. Понадобится пароль сервера.
          </span>
        </div>
      )}
      {state === "ended" && (
        <div className="flex items-center gap-3">
          <Button onClick={connect} variant="outline" size="sm">
            <Plug />
            Переподключиться
          </Button>
          <span className="text-[13px] text-ink-soft">
            Соединение с сервером прервалось.
          </span>
        </div>
      )}

      <div
        ref={boxRef}
        onScroll={() => {
          const el = boxRef.current;
          if (!el) return;
          stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
        }}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-soil p-4 font-mono text-[12px] leading-relaxed text-sprout"
      >
        {visibleLines.length === 0 ? (
          <span className="text-sprout/40">
            {state === "live"
              ? "Поток подключён — новые записи появятся здесь."
              : state === "connecting"
                ? "Подключаюсь…"
                : "Здесь будут логи в реальном времени."}
          </span>
        ) : (
          visibleLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap",
                line.channel === "err" && "text-[#f0876a]",
              )}
            >
              {line.text || " "}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-line bg-card p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors",
            option.value === value
              ? "bg-moss/10 text-moss"
              : "text-ink-soft hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StreamStatus({ state, paused }: { state: StreamState; paused: boolean }) {
  const [label, dotClass] =
    state === "live"
      ? paused
        ? ["на паузе", "bg-amber"]
        : ["в эфире", "bg-moss animate-pulse"]
      : state === "connecting"
        ? ["подключение…", "bg-sage"]
        : state === "ended"
          ? ["прервано", "bg-clay"]
          : ["не подключено", "bg-line"];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft">
      <span className={cn("size-2 rounded-full", dotClass)} />
      {label}
    </span>
  );
}
