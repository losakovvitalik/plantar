import { ChevronRight, GitCommit, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DeployRecord, Language } from "@plantar/storage";
import type { CommitsView, ProjectRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { Button } from "./ui/button";
import { DeployLogView } from "./deploy-log-view";

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

function formatWhen(iso: string, lang: Language): string {
  return new Date(iso).toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type BadgeKind = "onServer" | "deployed" | "failed" | "notDeployed";

const BADGE_STYLE: Record<BadgeKind, string> = {
  onServer: "bg-moss text-white",
  deployed: "bg-moss/10 text-moss",
  failed: "bg-clay/10 text-clay",
  notDeployed: "bg-muted text-ink-soft",
};

interface Props {
  project: ProjectRecord;
}

/** Список коммитов ветки с бейджем статуса деплоя и переходом к логу */
export function CommitsTab({ project }: Props) {
  const { t, lang } = useI18n();
  // Снимок «коммиты + статусы»: показывается устаревшим сразу, затем обновляется
  const [view, setView] = useState<CommitsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const result = await window.plantar.getCommitsView(project.id);
    setRefreshing(false);
    if (result.ok) {
      setError(null);
      setView(result.data);
    } else {
      setError(result.error);
    }
  }, [project.id]);

  // Смена проекта: сначала мгновенно показываем кэш, затем тянем свежий снимок
  useEffect(() => {
    setOpenHash(null);
    setError(null);
    let active = true;
    void (async () => {
      const cached = await window.plantar.getCommitsCache(project.id);
      if (active && cached.ok && cached.data) setView(cached.data);
      else if (active) setView(null);
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [project.id, load]);

  const commits = view?.commits ?? null;
  // История приходит новыми записями вперёд — первая запись коммита и есть последний деплой
  const latestDeploy = new Map<string, DeployRecord>();
  for (const record of view?.history ?? []) {
    if (record.commit && !latestDeploy.has(record.commit)) {
      latestDeploy.set(record.commit, record);
    }
  }
  const serverHash = project.deployedCommit?.hash;

  function badgeFor(hash: string, record: DeployRecord | undefined): BadgeKind {
    if (hash === serverHash) return "onServer";
    if (record?.status === "success") return "deployed";
    if (record?.status === "error") return "failed";
    return "notDeployed";
  }

  if (error) {
    return (
      <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] whitespace-pre-wrap text-clay">
        {error}
      </p>
    );
  }
  if (commits === null) {
    return <p className="text-[13px] text-ink-soft">{t("commits.loading")}</p>;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-[12.5px] text-ink-soft">
          {t("commits.branchHint", { branch: project.branch ?? "" })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-ink-soft"
          onClick={() => void load()}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          {t("commits.refresh")}
        </Button>
      </div>

      {commits.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <GitCommit className="mx-auto size-8 text-[#b8bfb8]" />
            <p className="mt-3 text-[13px] text-ink-soft">{t("commits.empty")}</p>
          </div>
        </div>
      ) : (
        <div
          className={`thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto transition-opacity ${
            refreshing ? "opacity-60" : ""
          }`}
        >
          {commits.map((commit) => {
            const record = latestDeploy.get(commit.hash);
            const kind = badgeFor(commit.hash, record);
            const isOpen = openHash === commit.hash;
            return (
              <div key={commit.hash} className="rounded-xl border border-line bg-card">
                <div className="flex items-center gap-1 pr-2">
                  <button
                    onClick={() =>
                      record && setOpenHash(isOpen ? null : commit.hash)
                    }
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-moss/50 ${
                      record ? "" : "cursor-default"
                    }`}
                  >
                    <ChevronRight
                      className={`size-4 shrink-0 text-ink-soft/60 transition-transform ${
                        record ? "" : "invisible"
                      } ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="shrink-0 font-mono text-[12.5px] text-moss">
                      {commit.hash.slice(0, 7)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">
                        {commit.subject}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ink-soft">
                        {commit.author} · {formatWhen(commit.date, lang)}
                      </div>
                    </div>
                  </button>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${BADGE_STYLE[kind]}`}
                  >
                    {t(`commits.badge.${kind}`)}
                  </span>
                </div>
                {isOpen && record && <DeployLogView logFile={record.logFile} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
