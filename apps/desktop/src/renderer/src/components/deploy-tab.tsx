import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Globe,
  PackageSearch,
  Rocket,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  /** Успешный деплой — родитель обновляет список (задеплоенный коммит git) */
  onDeployed: () => void;
}

const SHOW_COMMANDS_KEY = "plantar:showCommands";

function DeployError({ message }: { message: string }) {
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
    <div className="flex min-h-0 items-start gap-3 rounded-lg bg-clay/10 px-3 py-2 text-clay">
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
  );
}

export function DeployTab({
  project,
  server,
  config,
  askPassword,
  autoDeploy,
  onAutoDeployHandled,
  onDeployed,
}: Props) {
  const { t } = useI18n();
  const isGit = project.source === "git";
  const isExternal = Boolean(project.external);
  const needsFolder = isExternal && !project.path;
  // Репозиторий, из которого приложение было задеплоено на сервер (если нашёлся)
  const externalRepo = project.external?.repoUrl;
  const [linkingRepo, setLinkingRepo] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  // Что именно выполняется — деплой или возврат версии (для подписей кнопок)
  const [rollingBack, setRollingBack] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  // Успешный деплой без адреса (боты) — показываем текст вместо ссылки
  const [deployed, setDeployed] = useState(false);
  // Успешный возврат предыдущей версии — своя подпись результата
  const [rolledBack, setRolledBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(
    () => localStorage.getItem(SHOW_COMMANDS_KEY) !== "0",
  );
  const terminalRef = useRef<HTMLDivElement>(null);
  // Прилипание к низу: автоскролл только пока пользователь не проскроллил вверх
  const stickRef = useRef(true);

  useEffect(() => {
    const unsubscribe = window.plantar.onDeployLog((event) => {
      if (event.projectId === project.id) {
        setLines((prev) => [...prev, event.line]);
      }
    });
    return unsubscribe;
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

  async function deploy() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const password = await passwordFor(server, askPassword);
      if (password === null) return;
      setRunning(true);
      setRollingBack(false);
      setLines([]);
      stickRef.current = true;
      setUrl(null);
      setDeployed(false);
      setRolledBack(false);
      setError(null);
      const result = await window.plantar.deploy(project.id, password);
      setRunning(false);
      if (result.ok) {
        setUrl(result.data.url ?? null);
        setDeployed(true);
        onDeployed();
      } else {
        setError(result.error);
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function rollback() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!window.confirm(t("deploy.rollbackConfirm"))) return;
      const password = await passwordFor(server, askPassword);
      if (password === null) return;
      setRunning(true);
      setRollingBack(true);
      setLines([]);
      stickRef.current = true;
      setUrl(null);
      setDeployed(false);
      setRolledBack(false);
      setError(null);
      const result = await window.plantar.rollback(project.id, password);
      setRunning(false);
      setRollingBack(false);
      if (result.ok) {
        setUrl(result.data.url ?? null);
        setRolledBack(true);
        onDeployed();
      } else {
        setError(result.error);
      }
    } finally {
      busyRef.current = false;
    }
  }

  /** Привязка папки с кодом к импортированному проекту — открывает выбор папки */
  async function linkFolder() {
    setError(null);
    const result = await window.plantar.linkProjectFolder(project.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data) return; // выбор папки закрыли
    onDeployed(); // родитель перечитает список проектов и конфиг
  }

  /** Подключение обнаруженного репозитория: клонирует его и переводит проект в git-источник */
  async function linkRepo() {
    setError(null);
    setLinkingRepo(true);
    const result = await window.plantar.linkProjectRepo(project.id);
    setLinkingRepo(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDeployed();
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

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={deploy} disabled={running || !config || needsFolder}>
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
          disabled={running || !config || isExternal}
          title={isExternal ? t("deploy.rollbackExternalHint") : undefined}
        >
          <Undo2 />
          {rollingBack ? t("deploy.rollingBack") : t("deploy.rollback")}
        </Button>

        {config && config.type !== "bot" && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
            <Globe className="size-3.5" />
            {config.domain ? (
              <span className="font-semibold text-ink">{config.domain}</span>
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

      {error && <DeployError message={error} />}

      <div
        ref={terminalRef}
        onScroll={() => {
          const el = terminalRef.current;
          if (!el) return;
          stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
        }}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-soil p-4 font-mono text-[12.5px] leading-relaxed text-sprout"
      >
        {visibleLines.length === 0 ? (
          <span className="text-sprout/40">
            {running ? t("common.connecting") : t("deploy.terminalEmpty")}
          </span>
        ) : (
          visibleLines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
