import { CheckCircle2, ChevronRight, ExternalLink, History, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { DeployRecord, ProjectRecord } from "@plantar/storage";
import { Button } from "./ui/button";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(record: DeployRecord): string {
  const seconds = Math.round(
    (new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds} с`;
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

/** Раскрытая запись: лениво подгружает и показывает лог деплоя */
function DeployLogView({ logFile }: { logFile: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await window.plantar.readDeployLog(logFile);
      if (result.ok) setContent(result.data);
      else setError(result.error);
    })();
  }, [logFile]);

  if (error) {
    return (
      <p className="border-t border-line px-4 py-3 text-[12.5px] text-clay">
        Не удалось открыть лог: {error}
      </p>
    );
  }
  return (
    <pre className="thin-scroll max-h-72 overflow-y-auto rounded-b-xl bg-soil p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-sprout">
      {content ?? "Читаю лог…"}
    </pre>
  );
}

interface Props {
  project: ProjectRecord;
}

export function HistoryTab({ project }: Props) {
  const [records, setRecords] = useState<DeployRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);

  useEffect(() => {
    setRecords(null);
    setOpenLog(null);
    void (async () => {
      const result = await window.plantar.listHistory(project.id);
      if (result.ok) setRecords(result.data);
      else setError(result.error);
    })();
  }, [project.id]);

  if (error) {
    return <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] text-clay">{error}</p>;
  }
  if (records === null) {
    return <p className="text-[13px] text-ink-soft">Загружаю историю…</p>;
  }
  if (records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <History className="mx-auto size-8 text-[#b8bfb8]" />
          <h3 className="mt-3 text-[15px] font-bold">Пока ни одного деплоя</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            Здесь появится каждая попытка деплоя этого проекта — со статусом, временем и полным
            логом.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scroll flex h-full flex-col gap-2 overflow-y-auto">
      {records.map((record) => {
        const isOpen = openLog === record.logFile;
        return (
          <div key={record.logFile} className="rounded-xl border border-line bg-card">
            <div className="flex items-center gap-1 pr-2">
              <button
                onClick={() => setOpenLog(isOpen ? null : record.logFile)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-moss/50"
              >
                <ChevronRight
                  className={`size-4 shrink-0 text-ink-soft/60 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                {record.status === "success" ? (
                  <CheckCircle2 className="size-4.5 shrink-0 text-moss" />
                ) : (
                  <XCircle className="size-4.5 shrink-0 text-clay" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">
                    {formatWhen(record.startedAt)}
                    <span className="ml-2 font-normal text-ink-soft">
                      за {formatDuration(record)}
                    </span>
                  </div>
                  {record.status === "error" && (
                    <div className="mt-0.5 truncate text-[12.5px] text-clay">
                      {record.error?.split("\n")[0]}
                    </div>
                  )}
                </div>
              </button>
              {record.status === "success" && record.url && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void window.plantar.openExternal(record.url!)}
                  className="shrink-0"
                >
                  Открыть сайт
                  <ExternalLink />
                </Button>
              )}
            </div>
            {isOpen && <DeployLogView logFile={record.logFile} />}
          </div>
        );
      })}
    </div>
  );
}
