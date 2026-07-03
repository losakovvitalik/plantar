import { ExternalLink, Globe, Pencil, Rocket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectConfig, ProjectRecord, ServerRecord } from "../../../preload/index.d";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
  onProjectChanged: () => Promise<void>;
}

const SHOW_COMMANDS_KEY = "plantar:showCommands";

export function DeployTab({ project, server, askPassword, onProjectChanged }: Props) {
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(
    () => localStorage.getItem(SHOW_COMMANDS_KEY) !== "0",
  );
  const terminalRef = useRef<HTMLDivElement>(null);

  const loadConfig = useCallback(async () => {
    const result = await window.plantar.readProjectConfig(project.id);
    if (result.ok) {
      setConfig(result.data);
    } else {
      setError(result.error);
    }
  }, [project.id]);

  useEffect(() => {
    setError(null);
    void loadConfig();
  }, [loadConfig]);

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
    let password: string | undefined;
    if (server.auth === "password") {
      const entered = await askPassword(server);
      if (entered === null) return;
      password = entered;
    }
    setRunning(true);
    setLines([]);
    setUrl(null);
    setError(null);
    const result = await window.plantar.deploy(project.id, password);
    setRunning(false);
    if (result.ok) {
      setUrl(result.data.url);
    } else {
      setError(result.error);
    }
  }

  const visibleLines = showCommands ? lines : lines.filter((line) => !line.startsWith("$"));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={deploy} disabled={running || !config}>
          <Rocket />
          {running ? "Деплою…" : "Задеплоить"}
        </Button>

        {config && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
            <Globe className="size-3.5" />
            {config.domain ? (
              <span className="font-semibold text-ink">{config.domain}</span>
            ) : (
              <span>
                по IP <span className="font-mono">{server.host}</span>, без домена
              </span>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              title="Настройки проекта"
              className="rounded-md p-1 text-ink-soft outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-moss/50"
            >
              <Pencil className="size-3.5" />
            </button>
          </span>
        )}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft select-none">
          Показывать команды
          <Switch checked={showCommands} onCheckedChange={toggleCommands} />
        </label>
      </div>

      {url && (
        <button
          onClick={() => window.plantar.openExternal(url)}
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-moss outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
        >
          Сайт задеплоен: {url}
          <ExternalLink className="size-3.5" />
        </button>
      )}

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      <div
        ref={terminalRef}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl bg-soil p-4 font-mono text-[12.5px] leading-relaxed text-sprout"
      >
        {visibleLines.length === 0 ? (
          <span className="text-sprout/40">
            {running ? "Подключаюсь…" : "Здесь будет виден каждый шаг деплоя."}
          </span>
        ) : (
          visibleLines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))
        )}
      </div>

      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Настройки проекта"
        folderPath={project.path}
        initial={config ?? {}}
        submitLabel="Сохранить"
        onSubmit={async (input) => {
          const result = await window.plantar.writeProjectConfig(project.id, input);
          if (!result.ok) return result.error;
          setConfig(result.data);
          setSettingsOpen(false);
          await onProjectChanged();
          return null;
        }}
      />
    </div>
  );
}
