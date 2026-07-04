import { Settings2, Sprout } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectConfig,
  ProjectConfigInput,
  ProjectRecord,
  ServerRecord,
} from "../../preload/index.d";
import { AddServerDialog } from "./components/add-server-dialog";
import { ProjectSettingsDialog } from "./components/project-settings-dialog";
import { DeployTab } from "./components/deploy-tab";
import { EnvTab } from "./components/env-tab";
import { HistoryTab } from "./components/history-tab";
import { LogsTab } from "./components/logs-tab";
import { PasswordDialog } from "./components/password-dialog";
import { RemoveProjectDialog } from "./components/remove-project-dialog";
import { SettingsDialog } from "./components/settings-dialog";
import { Sidebar } from "./components/sidebar";
import { StatusTab } from "./components/status-tab";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

export type Selection = { kind: "server" | "project"; id: string } | null;

export default function App() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Промис-обёртка над диалогом пароля: askPassword(server) → ввод пользователя
  const [passwordFor, setPasswordFor] = useState<ServerRecord | null>(null);
  const passwordResolve = useRef<(value: string | null) => void>();
  const askPassword = useCallback((server: ServerRecord) => {
    setPasswordFor(server);
    return new Promise<string | null>((resolve) => {
      passwordResolve.current = resolve;
    });
  }, []);

  const refresh = useCallback(async () => {
    const [srv, prj] = await Promise.all([
      window.plantar.listServers(),
      window.plantar.listProjects(),
    ]);
    if (srv.ok) setServers(srv.data);
    if (prj.ok) setProjects(prj.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Клик по системному уведомлению о деплое открывает соответствующий проект
  useEffect(() => {
    return window.plantar.onOpenProject(({ projectId }) => {
      setSelection({ kind: "project", id: projectId });
    });
  }, []);

  const showError = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  // Любая непойманная ошибка должна быть видна пользователю, а не молча теряться
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason =
        e.reason instanceof Error ? e.reason.message : String(e.reason);
      showError(`Непредвиденная ошибка: ${reason}`);
    };
    const onError = (e: ErrorEvent) =>
      showError(`Непредвиденная ошибка: ${e.message}`);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, [showError]);

  // Папка выбрана — показываем экран подтверждения настроек перед добавлением
  const [newProject, setNewProject] = useState<{
    serverId: string;
    path: string;
    initial: Partial<ProjectConfigInput>;
    note: string;
  } | null>(null);

  async function addProject(serverId: string) {
    const picked = await window.plantar.pickProject();
    if (!picked.ok) {
      showError(picked.error);
      return;
    }
    if (!picked.data) return; // пользователь закрыл выбор папки

    const { path, config, detected } = picked.data;
    setNewProject({
      serverId,
      path,
      initial: config ?? detected.config,
      note: config
        ? "Настройки взяты из plantar.json в папке проекта."
        : `${detected.framework ? `Определён фреймворк: ${detected.framework}. ` : "Настройки определены автоматически. "}Проверьте внимательно значения и добавьте проект.`,
    });
  }

  async function removeServer(server: ServerRecord) {
    if (
      !window.confirm(
        `Удалить сервер «${server.name}» и его проекты из списка?`,
      )
    )
      return;
    await window.plantar.removeServer(server.id);
    if (selection?.id === server.id) setSelection(null);
    await refresh();
  }

  // Проект, для которого открыт диалог удаления (из списка или с сервера)
  const [removingProject, setRemovingProject] = useState<ProjectRecord | null>(
    null,
  );

  const selectedServer =
    selection?.kind === "server"
      ? servers.find((s) => s.id === selection.id)
      : undefined;
  const selectedProject =
    selection?.kind === "project"
      ? projects.find((p) => p.id === selection.id)
      : undefined;
  const projectServer = selectedProject
    ? servers.find((s) => s.id === selectedProject.serverId)
    : undefined;

  // Активная вкладка проекта и его конфиг — нужны вкладке «Деплой» и диалогу настроек
  const [tab, setTab] = useState("deploy");
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(
    null,
  );
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  // Настройки сохранены в этом сеансе диалога — показываем сообщение и кнопку «Деплой»
  const [settingsSaved, setSettingsSaved] = useState(false);
  // Просьба вкладке «Деплой» запустить деплой (кнопка «Деплой» в диалоге настроек)
  const [autoDeploy, setAutoDeploy] = useState(false);

  const selectedProjectId = selectedProject?.id;
  useEffect(() => {
    setTab("deploy");
    setAutoDeploy(false);
    setProjectConfig(null);
    if (!selectedProjectId) return;
    let cancelled = false;
    void window.plantar.readProjectConfig(selectedProjectId).then((result) => {
      if (cancelled) return;
      if (result.ok) setProjectConfig(result.data);
      else showError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, showError]);

  return (
    <div className="flex h-screen">
      {/* Зона перетаскивания окна на всю ширину; интерактивным элементам поверх неё нужен no-drag */}
      <div className="fixed inset-x-0 top-0 h-10 [-webkit-app-region:drag]" />
      <Sidebar
        servers={servers}
        projects={projects}
        selection={selection}
        onSelect={setSelection}
        onAddServer={() => setAddServerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onAddProject={addProject}
        onRemoveServer={removeServer}
        onRemoveProject={setRemovingProject}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {selectedProject && projectServer ? (
          <Tabs
            value={tab}
            onValueChange={setTab}
            key={selectedProject.id}
            className="flex h-full flex-col"
          >
            <header className="px-6 pt-5">
              <div className="flex items-baseline gap-3">
                <h1 className="text-lg font-bold">{selectedProject.name}</h1>
                <span className="font-mono text-[12px] text-ink-soft">
                  {projectServer.name} · {selectedProject.path}
                </span>
              </div>
              <div className="mt-3 flex items-center">
                <TabsList>
                  <TabsTrigger className="px-4" value="deploy">
                    Деплой
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="env">
                    Переменные
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="status">
                    Статус
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="logs">
                    Логи
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="history">
                    История
                  </TabsTrigger>
                </TabsList>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-ink-soft"
                  onClick={() => setProjectSettingsOpen(true)}
                  disabled={!projectConfig}
                >
                  <Settings2 className="size-3.5" />
                  Настройки проекта
                </Button>
              </div>
            </header>
            <div className="min-h-0 flex-1 px-6 py-5">
              <TabsContent value="deploy" className="h-full">
                <DeployTab
                  project={selectedProject}
                  server={projectServer}
                  config={projectConfig}
                  askPassword={askPassword}
                  autoDeploy={autoDeploy}
                  onAutoDeployHandled={() => setAutoDeploy(false)}
                />
              </TabsContent>
              <TabsContent value="env" className="h-full">
                <EnvTab
                  project={selectedProject}
                  server={projectServer}
                  askPassword={askPassword}
                />
              </TabsContent>
              <TabsContent value="status" className="h-full">
                <StatusTab server={projectServer} askPassword={askPassword} />
              </TabsContent>
              <TabsContent value="logs" className="h-full">
                <LogsTab
                  project={selectedProject}
                  server={projectServer}
                  config={projectConfig}
                  askPassword={askPassword}
                />
              </TabsContent>
              <TabsContent value="history" className="h-full">
                <HistoryTab project={selectedProject} />
              </TabsContent>
            </div>
          </Tabs>
        ) : selectedServer ? (
          <div className="flex h-full flex-col">
            <header className="px-6 pt-5">
              <h1 className="text-lg font-bold">{selectedServer.name}</h1>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                Сервер. Добавь проект через «+» в списке слева, чтобы деплоить.
              </p>
            </header>
            <div className="min-h-0 flex-1 px-6 py-5">
              <StatusTab server={selectedServer} askPassword={askPassword} />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm text-center">
              <Sprout className="mx-auto size-9 text-sage" />
              <h2 className="mt-3 text-[16px] font-bold">
                {servers.length === 0
                  ? "Добавь первый сервер"
                  : "Выбери сервер или проект"}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                {servers.length === 0
                  ? "Понадобятся IP-адрес и пароль — их выдаёт хостинг. Дальше Plantar настроит всё сам."
                  : "Слева — твои серверы и проекты на них."}
              </p>
            </div>
          </div>
        )}
      </main>

      {selectedProject && (
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          onOpenChange={(open) => {
            setProjectSettingsOpen(open);
            if (!open) setSettingsSaved(false);
          }}
          title="Настройки проекта"
          folderPath={selectedProject.path}
          initial={projectConfig ?? {}}
          submitLabel="Сохранить"
          savedMessage={
            settingsSaved
              ? "Настройки сохранены. Они применятся к приложению при следующем деплое."
              : undefined
          }
          onDeploy={() => {
            setProjectSettingsOpen(false);
            setSettingsSaved(false);
            setTab("deploy");
            setAutoDeploy(true);
          }}
          onSubmit={async (input) => {
            const result = await window.plantar.writeProjectConfig(
              selectedProject.id,
              input,
            );
            if (!result.ok) return result.error;
            const changed =
              JSON.stringify(result.data) !== JSON.stringify(projectConfig);
            setProjectConfig(result.data);
            await refresh();
            if (changed) setSettingsSaved(true);
            else setProjectSettingsOpen(false);
            return null;
          }}
        />
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AddServerDialog
        open={addServerOpen}
        onOpenChange={setAddServerOpen}
        onAdded={async (server) => {
          await refresh();
          setSelection({ kind: "server", id: server.id });
        }}
      />

      <ProjectSettingsDialog
        open={newProject !== null}
        onOpenChange={(open) => !open && setNewProject(null)}
        title="Новый проект"
        folderPath={newProject?.path ?? ""}
        initial={newProject?.initial ?? {}}
        note={newProject?.note}
        submitLabel="Добавить проект"
        onSubmit={async (config) => {
          if (!newProject) return null;
          const result = await window.plantar.addProject({
            serverId: newProject.serverId,
            path: newProject.path,
            config,
          });
          if (!result.ok) return result.error;
          setNewProject(null);
          await refresh();
          setSelection({ kind: "project", id: result.data.id });
          return null;
        }}
      />

      <RemoveProjectDialog
        project={removingProject}
        server={
          removingProject
            ? (servers.find((s) => s.id === removingProject.serverId) ?? null)
            : null
        }
        askPassword={askPassword}
        onClose={() => setRemovingProject(null)}
        onRemoved={async () => {
          if (selection?.id === removingProject?.id) setSelection(null);
          await refresh();
        }}
      />

      <PasswordDialog
        serverName={passwordFor ? passwordFor.name : null}
        onSubmit={(password) => {
          setPasswordFor(null);
          passwordResolve.current?.(password);
        }}
      />

      {toast && (
        <div className="fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border border-clay/30 bg-card px-4 py-3 text-[13px] whitespace-pre-wrap text-clay shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
