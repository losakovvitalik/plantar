import { RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Language } from "@plantar/storage";
import type {
  ExternalVersions,
  ProjectRecord,
  ServerRecord,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  /** Возврат версии запущен — родитель переключает на вкладку «Деплой» с логом */
  onRollbackStarted: () => void;
}

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

function formatDate(iso: string, lang: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Версии внешнего git-проекта: последние коммиты ветки с сервера.
 * Возврат версии — повторный деплой выбранного коммита (со сборкой),
 * в отличие от мгновенного переключения версий управляемых проектов.
 */
export function VersionsTab({ project, server, askPassword, onRollbackStarted }: Props) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<ExternalVersions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(password?: string) {
    setLoading(true);
    setError(null);
    const result = await window.plantar.externalVersions(project.id, password);
    setLoading(false);
    if (result.ok) setData(result.data);
    else setError(result.error);
  }

  async function refresh() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    await load(password);
  }

  useEffect(() => {
    setData(null);
    setError(null);
    // Без запроса пароля (ключ или живое соединение) — грузим сразу, иначе по кнопке
    void canConnectSilently(server).then((ok) => {
      if (ok) void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function restore(commit: { hash: string; shortHash: string }) {
    if (busy) return;
    if (!window.confirm(t("versions.confirm", { hash: commit.shortHash }))) return;
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setBusy(true);
    setError(null);
    // Ход возврата виден на вкладке «Деплой» — переключаемся сразу,
    // не дожидаясь конца сборки
    const resultPromise = window.plantar.rollbackExternalTo(
      project.id,
      commit.hash,
      password,
    );
    onRollbackStarted();
    const result = await resultPromise;
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <p className="rounded-lg bg-moss/8 px-3 py-2 text-[12.5px] leading-snug text-moss-deep">
        {t("versions.banner")}
      </p>

      {data?.behindTip && (
        <p className="rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-ink">
          <span className="font-semibold">{t("versions.behindTip")}</span>{" "}
          {t("versions.behindTipHint")}
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {data === null ? (
        loading ? (
          <p className="text-[13px] text-ink-soft">{t("versions.loading")}</p>
        ) : (
          <div>
            <Button onClick={refresh} variant="outline" size="sm">
              <RefreshCw />
              {t("versions.load")}
            </Button>
            {server.auth === "password" && (
              <p className="mt-2 text-[12.5px] text-ink-soft">
                {t("versions.passwordNeeded")}
              </p>
            )}
          </div>
        )
      ) : !data.hasGit ? (
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {t("versions.noGit")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
              className="text-ink-soft"
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
              {t("versions.refresh")}
            </Button>
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {data.commits.length === 0 ? (
              <p className="text-[13px] text-ink-soft">{t("versions.empty")}</p>
            ) : (
              <div className="flex flex-col gap-2 pb-4">
                {data.commits.map((commit) => {
                  const isCurrent = commit.hash === data.head;
                  return (
                    <div
                      key={commit.hash}
                      className="flex items-center gap-3 rounded-lg border border-line bg-card px-3 py-2"
                    >
                      <span className="shrink-0 font-mono text-[12px] text-moss">
                        {commit.shortHash}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {commit.subject}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-[11px] font-semibold text-moss">
                          {t("versions.current")}
                        </span>
                      )}
                      <span className="shrink-0 text-[12px] text-ink-soft">
                        {formatDate(commit.date, lang)} · {commit.author}
                      </span>
                      {!isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => void restore(commit)}
                          disabled={busy}
                        >
                          <Undo2 />
                          {t("versions.restore")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
