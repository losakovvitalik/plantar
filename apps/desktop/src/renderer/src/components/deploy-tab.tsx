import {
  ArrowRightLeft,
  Check,
  Copy,
  FolderOpen,
  GitBranch,
  Globe,
  Loader2,
  PackageSearch,
  Rocket,
  Undo2,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@plantar/storage";
import type {
  IpcResult,
  ProjectConfig,
  ProjectRecord,
  ServerRecord,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { deployOutcome } from "../lib/deploy-outcome";
import { passwordFor } from "../lib/server-auth";
import { type RunView, useDeployRun } from "../lib/use-deploy-run";
import { DeployOutcomeBanner } from "./deploy-outcome-banner";
import { MigrateProjectDialog } from "./migrate-project-dialog";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

function formatWhen(iso: string, lang: Language): string {
  return new Date(iso).toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeployError({
  message,
  onCompatRetry,
  onReturnPrevious,
}: {
  message: string;
  /** Конфликт зависимостей npm — показывает подсказку и кнопку режима совместимости */
  onCompatRetry?: () => void;
  /** Приложение не поднялось после деплоя — кнопка возврата предыдущей версии */
  onReturnPrevious?: () => void;
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
      {onReturnPrevious && (
        <div className="flex items-center gap-3 border-t border-clay/20 pt-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
            {t("deploy.returnPreviousHint")}
          </p>
          <Button size="sm" className="shrink-0" onClick={onReturnPrevious}>
            <Undo2 />
            {t("deploy.returnPrevious")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Running-step timer, isolated so the 1-second tick re-renders only this
 *  tiny component instead of the whole tab. Reads the shared start ref on
 *  every tick; `resetSignal` (the lines array) restarts the tick immediately
 *  when a new batch of lines lands, mirroring the old per-line reset. */
function StepTimer({
  startRef,
  resetSignal,
}: {
  startRef: { current: number };
  resetSignal: unknown;
}) {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)),
  );
  useEffect(() => {
    const update = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [startRef, resetSignal]);
  // Show the counter only on a lingering step; on quick ones it would flicker
  if (seconds < 5) return null;
  return (
    <span className="tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

/** Terminal body behind memo: re-renders only when a batch of lines lands or
 *  the command filter toggles — never on the 1-second step tick, which lives
 *  in StepTimer. All refs are stable, so props stay shallow-equal between
 *  unrelated parent renders. */
const Terminal = memo(function Terminal({
  visibleLines,
  running,
  idle,
  terminalRef,
  stickRef,
  stepStartRef,
}: {
  visibleLines: string[];
  running: boolean;
  /** No run to show yet — placeholder text instead of the spinner */
  idle: boolean;
  terminalRef: { current: HTMLDivElement | null };
  stickRef: { current: boolean };
  stepStartRef: { current: number };
}) {
  const { t } = useI18n();
  return (
    <div
      ref={terminalRef}
      data-testid="deploy-log"
      onScroll={() => {
        const el = terminalRef.current;
        if (!el) return;
        stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      }}
      className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-soil p-4 font-mono text-[12.5px] leading-relaxed text-sprout"
    >
      {visibleLines.length === 0 && (running || idle) ? (
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
              <StepTimer startRef={stepStartRef} resetSignal={visibleLines} />
            </div>
          )}
        </>
      )}
    </div>
  );
});

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
  // Репозиторий, из которого приложение было задеплоено на сервер (если нашёлся);
  // без него бережный деплой (git pull на месте) невозможен
  const externalRepo = project.external?.repoUrl;
  const externalGit = isExternal && Boolean(externalRepo);
  const [linkingRepo, setLinkingRepo] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  // Ошибка привязки папки/репозитория — не относится к прогону деплоя
  const [linkError, setLinkError] = useState<string | null>(null);
  // The run mirror from main: snapshot, subscriptions and the line buffer
  // live in the hook
  const { run, lines, stateLoaded, stepStartRef, startRunView, failRun } =
    useDeployRun(project.id);
  const [showCommands, setShowCommands] = useState(
    () => localStorage.getItem(SHOW_COMMANDS_KEY) !== "0",
  );
  const terminalRef = useRef<HTMLDivElement>(null);
  // Прилипание к низу: автоскролл только пока пользователь не проскроллил вверх
  const stickRef = useRef(true);

  const running = run?.status === "running";
  const rollingBack = running && run?.kind === "rollback";
  const outcome = deployOutcome(run, config?.type === "bot");
  const error = run?.status === "error" ? run.error : null;

  // View-local state resets alongside the run mirror on project switch
  useEffect(() => {
    setLinkError(null);
    stickRef.current = true;
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

  // Повторный запуск во время работы (двойной клик, двойной прогон эффекта
  // autoDeploy в StrictMode) ломал бы деплой; ref срабатывает сразу,
  // в отличие от состояния running
  const busyRef = useRef(false);

  /** Shared skeleton of the four run actions: double-start guard,
   *  confirmation, password prompt, view reset, kick-off in main. Success
   *  and run errors arrive via the deploy:finished event; only pre-start
   *  (validation) failures are handled here */
  async function runAction(action: {
    kind: RunView["kind"];
    confirmText?: string;
    /** Runs right after the password is obtained, before the view resets */
    beforeStart?: () => void;
    /** undefined — the saved key connects silently, no password needed */
    start: (password: string | undefined) => Promise<IpcResult<unknown>>;
    onSuccess?: () => void;
  }) {
    if (busyRef.current || running) return;
    busyRef.current = true;
    try {
      if (action.confirmText && !window.confirm(action.confirmText)) return;
      const password = await passwordFor(server, askPassword);
      if (password === null) return;
      action.beforeStart?.();
      setLinkError(null);
      stickRef.current = true;
      startRunView(action.kind);
      const result = await action.start(password);
      if (!result.ok) {
        failRun(result.error, result.code);
        return;
      }
      action.onSuccess?.();
    } finally {
      busyRef.current = false;
    }
  }

  function deploy(legacyPeerDeps = false) {
    return runAction({
      kind: "deploy",
      start: (password) => window.plantar.deploy(project.id, password, legacyPeerDeps),
    });
  }

  function rollback() {
    return runAction({
      kind: "rollback",
      confirmText: t("deploy.rollbackConfirm"),
      start: (password) => window.plantar.rollback(project.id, password),
    });
  }

  /** Возврат предыдущей версии внешнего проекта после неудачного деплоя:
   *  повторный деплой последнего успешно развёрнутого коммита */
  function returnPrevious() {
    const commit = project.deployedCommit?.hash;
    if (!commit) return;
    return runAction({
      kind: "rollback",
      confirmText: t("deploy.returnPreviousConfirm"),
      start: (password) =>
        window.plantar.rollbackExternalTo(project.id, commit, password),
    });
  }

  /** Перенос под управление Plantar — прежний takeover-деплой, после подтверждения */
  function migrate() {
    return runAction({
      kind: "migrate",
      beforeStart: () => setMigrateOpen(false),
      start: (password) => window.plantar.migrateProject(project.id, password),
      // Пометка «внешний» снята — родитель перечитает проект и конфиг
      onSuccess: onProjectChanged,
    });
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

  // Memoized: filtering up to 2000 lines must not rerun on unrelated renders
  const visibleLines = useMemo(
    () => (showCommands ? lines : lines.filter((line) => !line.startsWith("$"))),
    [lines, showCommands],
  );

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

  // External project without a git remote: the deploy button is disabled and the
  // tooltip explains why. Radix tooltips don't fire on disabled elements, so the
  // trigger is a span wrapper; when the button is enabled there is no tooltip at all.
  const deployButton = (
    <Button
      data-testid="deploy-start"
      onClick={() => void deploy()}
      disabled={!stateLoaded || running || !config || (isExternal && !externalGit)}
    >
      <Rocket />
      {running && !rollingBack
        ? t("deploy.running")
        : isGit || externalGit
          ? t("deploy.updateAndDeploy")
          : t("deploy.start")}
    </Button>
  );

  // Same span-wrapper trick for the migrate button: the tooltip explains the
  // disabled state while the project has no linked folder.
  const migrateButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setMigrateOpen(true)}
      disabled={needsFolder || running}
    >
      <ArrowRightLeft />
      {t("deploy.migrate")}
    </Button>
  );

  return (
    <div
      className="flex h-full flex-col gap-4"
      data-testid="deploy-tab"
      data-run-status={run?.status ?? "idle"}
    >
      <div className="flex items-center gap-3">
        {isExternal && !externalGit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{deployButton}</span>
            </TooltipTrigger>
            <TooltipContent>{t("deploy.externalNoGitHint")}</TooltipContent>
          </Tooltip>
        ) : (
          deployButton
        )}

        {/* У внешних проектов возврат версии живёт на вкладке «Версии» (по git),
            поэтому кнопки здесь честно нет, а не задизейблена */}
        {!isExternal && (
          <Button
            variant="outline"
            onClick={rollback}
            disabled={!stateLoaded || running || !config}
          >
            <Undo2 />
            {rollingBack ? t("deploy.rollingBack") : t("deploy.rollback")}
          </Button>
        )}

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
        <div className="flex items-start gap-3 rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-ink">
          <PackageSearch className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {externalGit ? t("deploy.externalHint") : t("deploy.externalNoGitHint")}
            {needsFolder && <> {t("deploy.externalLinkHint")}</>}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {needsFolder && externalRepo && (
              <Button
                size="sm"
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
                onClick={() => void linkFolder()}
                disabled={linkingRepo}
              >
                <FolderOpen />
                {t("deploy.pickFolder")}
              </Button>
            )}
            {needsFolder ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>{migrateButton}</span>
                </TooltipTrigger>
                <TooltipContent>{t("deploy.migrateNeedsFolder")}</TooltipContent>
              </Tooltip>
            ) : (
              migrateButton
            )}
          </div>
        </div>
      )}

      {(isGit || externalGit) && (
        <div className="flex items-center gap-2 rounded-lg bg-moss/5 px-3 py-2 text-[12.5px] text-ink-soft">
          <GitBranch className="size-3.5 shrink-0 text-moss" />
          <span className="font-mono font-semibold text-ink">
            {project.branch ?? project.external?.branch}
          </span>
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

      <DeployOutcomeBanner outcome={outcome} />

      {linkError ? (
        <DeployError message={linkError} />
      ) : (
        error && (
          <DeployError
            message={error.message}
            onCompatRetry={
              error.code === "npm-peer-conflict" ? () => void deploy(true) : undefined
            }
            onReturnPrevious={
              // After a failed migrate the old pm2 process is already deleted
              // by the takeover, so "return to previous version" cannot work —
              // the button is only for failed in-place runs
              externalGit &&
              run?.kind !== "migrate" &&
              project.deployedCommit &&
              (error.code === "app-not-responding" ||
                error.code === "process-unstable")
                ? () => void returnPrevious()
                : undefined
            }
          />
        )
      )}

      {lastRunLabel && (
        <div className="text-[12px] text-ink-soft">{lastRunLabel}</div>
      )}

      <Terminal
        visibleLines={visibleLines}
        running={running}
        idle={!run}
        terminalRef={terminalRef}
        stickRef={stickRef}
        stepStartRef={stepStartRef}
      />

      {isExternal && config && (
        <MigrateProjectDialog
          open={migrateOpen}
          onOpenChange={setMigrateOpen}
          project={project}
          configName={config.name}
          onConfirm={() => void migrate()}
        />
      )}
    </div>
  );
}
