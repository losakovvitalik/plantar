import { Check, Copy, ExternalLink, GitBranch, Globe, Rocket } from "lucide-react";
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
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  // Успешный деплой без адреса (боты) — показываем текст вместо ссылки
  const [deployed, setDeployed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(
    () => localStorage.getItem(SHOW_COMMANDS_KEY) !== "0",
  );
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = window.plantar.onDeployLog((event) => {
      if (event.projectId === project.id) {
        setLines((prev) => [...prev, event.line]);
      }
    });
    return unsubscribe;
  }, [project.id]);

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
  }, [lines]);

  function toggleCommands(value: boolean) {
    setShowCommands(value);
    localStorage.setItem(SHOW_COMMANDS_KEY, value ? "1" : "0");
  }

  async function deploy() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setRunning(true);
    setLines([]);
    setUrl(null);
    setDeployed(false);
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
        <Button onClick={deploy} disabled={running || !config}>
          <Rocket />
          {running
            ? t("deploy.running")
            : isGit
              ? t("deploy.updateAndDeploy")
              : t("deploy.start")}
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
          {t("deploy.deployedAt", { url })}
          <ExternalLink className="size-3.5" />
        </button>
      ) : (
        deployed && (
          <p className="self-start text-sm font-semibold text-moss">
            {t("deploy.botDeployed")}
          </p>
        )
      )}

      {error && <DeployError message={error} />}

      <div
        ref={terminalRef}
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
