import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  History,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DeployRecord, Language, ProjectRecord } from "@plantar/storage";
import { type Translate, useI18n } from "../i18n";
import { deployOutcome } from "../lib/deploy-outcome";
import { Button } from "./ui/button";
import { DeployLogView } from "./deploy-log-view";

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

function formatWhen(iso: string, lang: Language): string {
  return new Date(iso).toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(record: DeployRecord, t: Translate): string {
  const seconds = Math.round(
    (new Date(record.finishedAt).getTime() -
      new Date(record.startedAt).getTime()) /
      1000,
  );
  if (seconds < 60) return t("history.seconds", { seconds });
  return t("history.minutesSeconds", {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  });
}

interface Props {
  project: ProjectRecord;
}

export function HistoryTab({ project }: Props) {
  const { t, lang } = useI18n();
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
    return (
      <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] text-clay">
        {error}
      </p>
    );
  }
  if (records === null) {
    return <p className="text-[13px] text-ink-soft">{t("history.loading")}</p>;
  }
  if (records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <History className="mx-auto size-8 text-[#b8bfb8]" />
          <h3 className="mt-3 text-[15px] font-bold">
            {t("history.emptyTitle")}
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            {t("history.emptyHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scroll flex h-full flex-col gap-2 overflow-y-auto">
      {records.map((record) => {
        const isOpen = openLog === record.logFile;
        // Same rule as the "Deploy" tab: an address that did not answer the
        // check is not passed off as a working link here either. The button
        // still stays — it only loses the confirmed look and says in its
        // tooltip what the check saw right after that deploy
        const outcome = deployOutcome(record);
        const site =
          outcome.kind === "link"
            ? { url: outcome.url, hint: undefined, confirmed: true }
            : outcome.kind === "unreachable"
              ? {
                  url: outcome.url,
                  hint: t("history.openSiteNoResponse"),
                  confirmed: false,
                }
              : outcome.kind === "plainHttp"
                ? {
                    url: outcome.plainUrl,
                    hint: t("history.openSitePlainHttp", { url: outcome.plainUrl }),
                    confirmed: false,
                  }
                : null;
        return (
          <div
            key={record.logFile}
            className="rounded-xl border border-line bg-card"
          >
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
                    {formatWhen(record.startedAt, lang)}
                    <span className="ml-2 font-normal text-ink-soft">
                      {t("history.duration", {
                        duration: formatDuration(record, t),
                      })}
                    </span>
                    {record.kind === "rollback" && (
                      <span className="ml-2 rounded-full bg-moss/10 px-2 py-0.5 text-[11px] font-semibold text-moss">
                        {t("history.rollback")}
                      </span>
                    )}
                  </div>
                  {record.status === "error" && (
                    <div className="mt-0.5 truncate text-[12.5px] text-clay">
                      {record.error?.split("\n")[0]}
                    </div>
                  )}
                </div>
              </button>
              {site && (
                <Button
                  variant="ghost"
                  size="sm"
                  title={site.hint}
                  onClick={() => void window.plantar.openExternal(site.url)}
                  className={site.confirmed ? "shrink-0" : "shrink-0 text-ink-soft"}
                >
                  {t("history.openSite")}
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
