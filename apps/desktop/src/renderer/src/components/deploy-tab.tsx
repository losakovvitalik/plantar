import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Globe,
  Loader2,
  PackageSearch,
  Rocket,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Language } from "@plantar/storage";
import type {
  ProjectConfig,
  ProjectRecord,
  ServerRecord,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { passwordFor } from "../lib/server-auth";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  config: ProjectConfig | null;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  /** Запустить деплой сразу — кнопка «Деплой» в настройках проекта */
  autoDeploy: boolean;
  onAutoDeployHandled: () => void;
  /** Проект изменился (привязана папка или репозиторий) — родитель
   *  перечитывает список проектов и конфиг */
  onProjectChanged: () => void;
}

const SHOW_COMMANDS_KEY = "plantar:showCommands";

/** Лимит строк терминала — как у буфера прогона в main; длинный лог
 *  восстановленного npm install не должен раздувать DOM */
const MAX_TERMINAL_LINES = 2000;

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

function formatWhen(iso: string, lang: Language): string {
  return new Date(iso).toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Прогон деплоя глазами вкладки — зеркало состояния main */
interface RunView {
  status: "running" | "success" | "error" | "interrupted";
  kind: "deploy" | "rollback";
  startedAt: string;
  url: string | null;
  error: { message: string; code?: string } | null;
}

function DeployError({
  message,
  onCompatRetry,
}: {
  message: string;
  /** Конфликт зависимостей npm — показывает подсказку и кнопку режима совместимости */
  onCompatRetry?: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const errorLines = message.split(/\r?\n/);
  const hasMore = errorLines.length > 4;
  const content = expanded ? message : errorLines.slice(0, 4).join("\n");

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // Fallback для окружений Electron, где Clipboard API недоступен для file://.
      const textarea = document.createElement("textarea");
      textarea.value = message;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      textarea.remove();
      if (!success) return;
    }

    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 rounded-lg bg-clay/10 px-3 py-2 text-clay">
      <div className="flex min-h-0 items-start gap-3">
        <pre
          className={`thin-scroll min-w-0 flex-1 font-sans text-[12.5px] leading-snug break-words whitespace-pre-wrap ${
            expanded
              ? "max-h-[16.5em] overflow-y-auto"
              : hasMore
                ? "max-h-[5.5em] overflow-hidden"
                : ""
          }`}
        >
          {content}
        </pre>
        <div className="flex shrink-0 items-center gap-3">
          {hasMore && (
            <button
              type="button"
              className="rounded-sm text-[12.5px] font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-clay/40"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t("deploy.hideError") : t("deploy.showMoreError")}
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm text-[12.5px] font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-clay/40"
            onClick={() => void copyMessage()}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? t("deploy.errorCopied") : t("deploy.copyError")}
          </button>
        </div>
      </div>
      {onCompatRetry && (
        <div className="flex items-center gap-3 border-t border-clay/20 pt-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
            {t("deploy.peerConflictHint")}
          </p>
          <Button size="sm" className="shrink-0" onClick={onCompatRetry}>
            {t("deploy.compatRetry")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DeployTab({
  project,
  server,
  config,
  askPassword,
  autoDeploy,
  onAutoDeployHandled,
  onProjectChanged,
}: Props) {
  const { t, lang } = useI18n();
  const isGit = project.source === "git";
  const isExternal = Boolean(project.external);
  const needsFolder = isExternal && !project.path;
  // Репозиторий, из которого приложение было задеплоено на сервер (если нашёлся)
  const externalRepo = project.external?.repoUrl;
  const [linkingRepo, setLinkingRepo] = useState(false);
  // Ошибка привязки папки/репозитория — не относится к прогону деплоя
  const [linkError, setLinkError] = useState<string | null>(null);
  // Состояние прогона живёт в main; вкладка показывает его снимок + события
  const [run, setRun] = useState<RunView | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  // Пока снимок не получен, кнопки неактивны — иначе можно запустить второй деплой
  const [stateLoaded, setStateLoaded] = useState(false);
  const lastSeqRef = useRef(0);
  const [showCommands, setShowCommands] = useState(
    () => localStorage.getItem(SHOW_COMMANDS_KEY) !== "0",
  );
  const terminalRef = useRef<HTMLDivElement>(null);
  // Прилипание к низу: автоскролл только пока пользователь не проскроллил вверх
  const stickRef = useRef(true);

  const running = run?.status === "running";
  const rollingBack = running && run?.kind === "rollback";
  const success = run?.status === "success";
  const url = success ? (run?.url ?? null) : null;
  const deployed = success && run?.kind === "deploy";
  const rolledBack = success && run?.kind === "rollback";
  const error = run?.status === "error" ? run.error : null;

  // Длительность текущего шага: долгие команды (npm install, сборка) не пишут в лог
  // до завершения, и без бегущего счётчика деплой выглядит зависшим.
  // Точка отсчёта — время последней строки, она переживает перемонтирование вкладки.
  const stepStartRef = useRef(Date.now());
  const [stepSeconds, setStepSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setStepSeconds(
        Math.max(0, Math.floor((Date.now() - stepStartRef.current) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    setRun(null);
    setLines([]);
    setStateLoaded(false);
    setLinkError(null);
    lastSeqRef.current = 0;
    stickRef.current = true;
    let disposed = false;
    let loaded = false;
    // Строки, пришедшие между запросом снимка и ответом, — применяются после снимка
    const pending: { seq: number; line: string }[] = [];

    const append = (seq: number, line: string) => {
      // Номера строк закрывают гонку снимка и подписки: дубли отбрасываются
      if (seq <= lastSeqRef.current) return;
      lastSeqRef.current = seq;
      stepStartRef.current = Date.now();
      setStepSeconds(0);
      setLines((prev) => [...prev, line].slice(-MAX_TERMINAL_LINES));
    };

    const unsubscribeLog = window.plantar.onDeployLog((event) => {
      if (event.projectId !== project.id) return;
      if (!loaded) {
        pending.push(event);
        return;
      }
      append(event.seq, event.line);
    });
    const unsubscribeFinished = window.plantar.onDeployFinished((event) => {
      if (event.projectId !== project.id) return;
      setRun(
        (prev) =>
          prev && {
            ...prev,
            status: event.status,
            url: event.url ?? null,
            error:
              event.status === "error"
                ? { message: event.error ?? "", code: event.code }
                : null,
          },
      );
    });

    void window.plantar.getDeployState(project.id).then((result) => {
      if (disposed) return;
      loaded = true;
      setStateLoaded(true);
      if (!result.ok || !result.data) return;
      const state = result.data;
      lastSeqRef.current = state.lastSeq;
      setLines(state.lines.slice(-MAX_TERMINAL_LINES));
      setRun({
        status: state.status,
        kind: state.kind,
        startedAt: state.startedAt,
        url: state.url ?? null,
        error: state.error
          ? { message: state.error, code: state.errorCode }
          : null,
      });
      if (state.status === "running") {
        // Счётчик шага продолжается от последней строки, а не с нуля
        stepStartRef.current =
          Date.parse(state.lastLineAt || state.startedAt) || Date.now();
        setStepSeconds(
          Math.max(0, Math.floor((Date.now() - stepStartRef.current) / 1000)),
        );
      }
      for (const event of pending) append(event.seq, event.line);
    });

    return () => {
      disposed = true;
      unsubscribeLog();
      unsubscribeFinished();
    };
  }, [project.id]);

  useEffect(() => {
    if (stickRef.current) {
      terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
    }
  }, [lines]);

  function toggleCommands(value: boolean) {
    setShowCommands(value);
    localStorage.setItem(SHOW_COMMANDS_KEY, value ? "1" : "0");
  }

  /** Сброс вкладки под новый прогон — до ответа main, чтобы клик отзывался мгновенно */
  function startRunView(kind: "deploy" | "rollback") {
    setRun({
      status: "running",
      kind,
      startedAt: new Date().toISOString(),
      url: null,
      error: null,
    });
    setLines([]);
    setLinkError(null);
    lastSeqRef.current = 0;
    stickRef.current = true;
    stepStartRef.current = Date.now();
    setStepSeconds(0);
  }

  // Повторный запуск во время работы (двойной клик, двойной прогон эффекта
  // autoDeploy в StrictMode) ломал бы деплой; ref срабатывает сразу,
  // в отличие от состояния running
  const busyRef = useRef(false);

  async function deploy(legacyPeerDeps = false) {
    if (busyRef.current || running) return;
    busyRef.current = true;
    try {
      const password = await passwordFor(server, askPassword);
      if (password === null) return;
      startRunView("deploy");
      const result = await window.plantar.deploy(project.id, password, legacyPeerDeps);
      // Успех и ошибки прогона приходят событием deploy:finished;
      // здесь остаются только ошибки до старта прогона (валидация)
      if (!result.ok) {
        setRun((prev) =>
          prev && prev.status === "running"
            ? {
                ...prev,
                status: "error",
                error: { message: result.error, code: result.code },
              }
            : prev,
        );
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function rollback() {
    if (busyRef.current || running) return;
    busyRef.current = true;
    try {
      if (!window.confirm(t("deploy.rollbackConfirm"))) return;
      const password = await passwordFor(server, askPassword);
      if (password === null) return;
      startRunView("rollback");
      const result = await window.plantar.rollback(project.id, password);
      if (!result.ok) {
        setRun((prev) =>
          prev && prev.status === "running"
            ? { ...prev, status: "error", error: { message: result.error } }
            : prev,
        );
      }
    } finally {
      busyRef.current = false;
    }
  }

  /** Привязка папки с кодом к импортированному проекту — открывает выбор папки */
  async function linkFolder() {
    setLinkError(null);
    const result = await window.plantar.linkProjectFolder(project.id);
    if (!result.ok) {
      setLinkError(result.error);
      return;
    }
    if (!result.data) return; // выбор папки закрыли
    onProjectChanged(); // родитель перечитает список проектов и конфиг
  }

  /** Подключение обнаруженного репозитория: клонирует его и переводит проект в git-источник */
  async function linkRepo() {
    setLinkError(null);
    setLinkingRepo(true);
    const result = await window.plantar.linkProjectRepo(project.id);
    setLinkingRepo(false);
    if (!result.ok) {
      setLinkError(result.error);
      return;
    }
    onProjectChanged();
  }

  useEffect(() => {
    if (autoDeploy) {
      onAutoDeployHandled();
      void deploy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDeploy]);

  const visibleLines = showCommands
    ? lines
    : lines.filter((line) => !line.startsWith("$"));

  const lastRunLabel =
    run && !running
      ? `${t(
          run.kind === "rollback"
            ? "deploy.lastRunRollback"
            : "deploy.lastRunDeploy",
          { when: run.startedAt ? formatWhen(run.startedAt, lang) : "—" },
        )} · ${
          run.status === "success"
            ? t("deploy.lastRunSuccess")
            : run.status === "error"
              ? t("deploy.lastRunError")
              : t("deploy.lastRunInterrupted")
        }`
      : null;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button
          onClick={() => void deploy()}
          disabled={!stateLoaded || running || !config || needsFolder}
        >
          <Rocket />
          {running && !rollingBack
            ? t("deploy.running")
            : isGit
              ? t("deploy.updateAndDeploy")
              : t("deploy.start")}
        </Button>

        <Button
          variant="outline"
          onClick={rollback}
          disabled={!stateLoaded || running || !config || isExternal}
          title={isExternal ? t("deploy.rollbackExternalHint") : undefined}
        >
          <Undo2 />
          {rollingBack ? t("deploy.rollingBack") : t("deploy.rollback")}
        </Button>

        {config && config.type !== "bot" && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
            <Globe className="size-3.5" />
            {config.domain ? (
              <button
                type="button"
                onClick={() =>
                  void window.plantar.openExternal(`https://${config.domain}/`)
                }
                className="font-semibold text-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
              >
                {config.domain}
              </button>
            ) : (
              <span>
                {t("deploy.viaIp")}{" "}
                <span className="font-mono">{server.host}</span>
                {t("deploy.noDomain")}
              </span>
            )}
          </span>
        )}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft select-none">
          {t("deploy.showCommands")}
          <Switch checked={showCommands} onCheckedChange={toggleCommands} />
        </label>
      </div>

      {isExternal && (
        <div className="flex items-center gap-3 rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-ink">
          <PackageSearch className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {!needsFolder ? (
              t("deploy.externalHint")
            ) : externalRepo ? (
              <>
                {t("deploy.externalRepoBefore")}{" "}
                <button
                  type="button"
                  onClick={() => void window.plantar.openExternal(externalRepo)}
                  className="break-all font-semibold text-moss underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
                >
                  {externalRepo}
                </button>
                {t("deploy.externalRepoAfter")}
              </>
            ) : (
              t("deploy.externalNeedsFolder")
            )}
          </span>
          {needsFolder && externalRepo && (
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => void linkRepo()}
              disabled={linkingRepo}
            >
              <GitBranch />
              {linkingRepo ? t("deploy.connectingRepo") : t("deploy.connectRepo")}
            </Button>
          )}
          {needsFolder && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void linkFolder()}
              disabled={linkingRepo}
            >
              <FolderOpen />
              {t("deploy.pickFolder")}
            </Button>
          )}
        </div>
      )}

      {isGit && (
        <div className="flex items-center gap-2 rounded-lg bg-moss/5 px-3 py-2 text-[12.5px] text-ink-soft">
          <GitBranch className="size-3.5 shrink-0 text-moss" />
          <span className="font-mono font-semibold text-ink">{project.branch}</span>
          {project.deployedCommit ? (
            <span className="min-w-0 truncate">
              <span className="font-mono text-moss">
                {project.deployedCommit.hash.slice(0, 7)}
              </span>{" "}
              {project.deployedCommit.message}
            </span>
          ) : (
            <span>{t("deploy.notDeployedYet")}</span>
          )}
        </div>
      )}

      {url ? (
        <button
          onClick={() => window.plantar.openExternal(url)}
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-moss outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
        >
          {rolledBack
            ? t("deploy.rolledBackAt", { url })
            : t("deploy.deployedAt", { url })}
          <ExternalLink className="size-3.5" />
        </button>
      ) : deployed ? (
        <p className="self-start text-sm font-semibold text-moss">
          {t("deploy.botDeployed")}
        </p>
      ) : (
        rolledBack && (
          <p className="self-start text-sm font-semibold text-moss">
            {t("deploy.rolledBackDone")}
          </p>
        )
      )}

      {linkError ? (
        <DeployError message={linkError} />
      ) : (
        error && (
          <DeployError
            message={error.message}
            onCompatRetry={
              error.code === "npm-peer-conflict" ? () => void deploy(true) : undefined
            }
          />
        )
      )}

      {lastRunLabel && (
        <div className="text-[12px] text-ink-soft">{lastRunLabel}</div>
      )}

      <div
        ref={terminalRef}
        onScroll={() => {
          const el = terminalRef.current;
          if (!el) return;
          stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
        }}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-soil p-4 font-mono text-[12.5px] leading-relaxed text-sprout"
      >
        {visibleLines.length === 0 && (running || !run) ? (
          <span className="inline-flex items-center gap-2 text-sprout/40">
            {running && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
            {running ? t("common.connecting") : t("deploy.terminalEmpty")}
          </span>
        ) : (
          <>
            {visibleLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
            {running && (
              <div className="mt-1 flex items-center gap-2 text-sprout/60">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                {/* Счётчик — только на затянувшемся шаге; на быстрых был бы мельтешением */}
                {stepSeconds >= 5 && (
                  <span className="tabular-nums">
                    {Math.floor(stepSeconds / 60)}:
                    {String(stepSeconds % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
