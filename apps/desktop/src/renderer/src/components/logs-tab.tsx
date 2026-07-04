import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectRecord, ServerRecord, SiteLogs } from "../../../preload/index.d";
import { passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

export function LogsTab({ project, server, askPassword }: Props) {
  const [logs, setLogs] = useState<SiteLogs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLogs(null);
    setError(null);
  }, [project.id]);

  async function load() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setLoading(true);
    setError(null);
    const result = await window.plantar.getLogs(project.id, password);
    setLoading(false);
    if (result.ok) {
      setLogs(result.data);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={cn(loading && "animate-spin")} />
          {loading ? "Загружаю…" : logs ? "Обновить" : "Загрузить логи"}
        </Button>
      </div>

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {logs ? (
        <div className="grid min-h-0 flex-1 grid-rows-[2fr_1fr] gap-3">
          <LogPanel title="Запросы (access)" content={logs.access} />
          <LogPanel title="Ошибки (error)" content={logs.error} />
        </div>
      ) : (
        !loading && (
          <p className="text-[13px] text-ink-soft">
            Логи nginx с сервера: кто и когда открывал сайт и какие были ошибки.
          </p>
        )
      )}
    </div>
  );
}

function LogPanel({ title, content }: { title: string; content: string }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-soil">
      <div className="px-4 pt-3 pb-1 text-[11px] font-bold tracking-[0.14em] text-sprout/50 uppercase">
        {title}
      </div>
      <pre className="thin-scroll min-h-0 flex-1 overflow-auto px-4 pb-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-sprout">
        {content || <span className="text-sprout/40">(пусто)</span>}
      </pre>
    </div>
  );
}
