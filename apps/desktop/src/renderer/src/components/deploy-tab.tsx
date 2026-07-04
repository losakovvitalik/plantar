import { ExternalLink, Globe, Rocket, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectConfig, ProjectRecord, ServerRecord } from "../../../preload/index.d";
import { ProjectSettingsDialog } from "./project-settings-dialog";
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
  // Успешный деплой без адреса (боты) — показываем текст вместо ссылки
  const [deployed, setDeployed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Настройки сохранены, но ещё не применены к серверу деплоем
  const [pendingSettings, setPendingSettings] = useState(false);
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
    setPendingSettings(false);
    setLines([]);
    setUrl(null);
    setDeployed(false);
    setError(null);
    const result = await window.plantar.deploy(project.id, password);
    setRunning(false);
    if (result.ok) {
      setUrl(result.data.url ?? null);
      setDeployed(true);
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

        {config && config.type !== "bot" && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
            <Globe className="size-3.5" />
            {config.domain ? (
              <span className="font-semibold text-ink">{config.domain}</span>
            ) : (
              <span>
                по IP <span className="font-mono">{server.host}</span>, без домена
              </span>
            )}
          </span>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-ink-soft"
          onClick={() => setSettingsOpen(true)}
          disabled={!config}
        >
          <Settings2 className="size-3.5" />
          Настройки проекта
        </Button>

        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft select-none">
          Показывать команды
          <Switch checked={showCommands} onCheckedChange={toggleCommands} />
        </label>
      </div>

      {pendingSettings && !running && (
        <p className="rounded-lg bg-moss/10 px-3 py-2 text-[12.5px] leading-snug text-moss">
          Настройки сохранены. Они применятся к сайту при следующем деплое.
        </p>
      )}

      {url ? (
        <button
          onClick={() => window.plantar.openExternal(url)}
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-moss outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
        >
          Сайт задеплоен: {url}
          <ExternalLink className="size-3.5" />
        </button>
      ) : (
        deployed && (
          <p className="self-start text-sm font-semibold text-moss">
            Бот задеплоен и запущен.
          </p>
        )
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
          if (JSON.stringify(result.data) !== JSON.stringify(config)) {
            setPendingSettings(true);
          }
          setConfig(result.data);
          setSettingsOpen(false);
          await onProjectChanged();
          return null;
        }}
      />
    </div>
  );
}
