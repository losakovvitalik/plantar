import { Radar, Settings2, Sprout } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectConfig,
  ProjectConfigInput,
  ProjectRecord,
  ServerRecord,
} from "../../preload/index.d";
import { AddProjectDialog } from "./components/add-project-dialog";
import { AddServerDialog } from "./components/add-server-dialog";
import { AppStatusTab } from "./components/app-status-tab";
import { DiscoverAppsDialog } from "./components/discover-apps-dialog";
import { ProjectSettingsDialog } from "./components/project-settings-dialog";
import { CommitsTab } from "./components/commits-tab";
import { DeployTab } from "./components/deploy-tab";
import { EnvTab } from "./components/env-tab";
import { FilesTab } from "./components/files-tab";
import { HistoryTab } from "./components/history-tab";
import { LogsTab } from "./components/logs-tab";
import { PasswordDialog } from "./components/password-dialog";
import { RemoveProjectDialog } from "./components/remove-project-dialog";
import { ServerMonitoring } from "./components/server-monitoring";
import { SettingsDialog } from "./components/settings-dialog";
import { Sidebar } from "./components/sidebar";
import { StatusTab } from "./components/status-tab";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useI18n } from "./i18n";
import { useAppStatuses } from "./lib/use-app-statuses";
import { useDeploys } from "./lib/use-deploys";

export type Selection = { kind: "server" | "project"; id: string } | null;

export default function App() {
  const { t } = useI18n();
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

  // Индикаторы «работает/не работает» в сайдбаре; каждое обновление списка
  // (добавление, деплой) перепроверяет статусы
  const {
    statuses,
    refreshing: statusesRefreshing,
    refresh: refreshStatuses,
  } = useAppStatuses(servers);

  // Идущие деплои — спиннеры у проектов в сайдбаре
  const activeDeploys = useDeploys();

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
      showError(t("app.unexpectedError", { message: reason }));
    };
    const onError = (e: ErrorEvent) =>
      showError(t("app.unexpectedError", { message: e.message }));
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, [showError, t]);

  // Перетаскивание в сайдбаре: порядок меняем сразу, сохранение — в фоне;
  // при ошибке записи возвращаем порядок с диска
  const reorderServers = useCallback(
    (ids: string[]) => {
      const index = new Map(ids.map((id, i) => [id, i]));
      setServers((prev) =>
        [...prev].sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)),
      );
      void window.plantar.reorderServers(ids).then((result) => {
        if (!result.ok) {
          showError(result.error);
          void refresh();
        }
      });
    },
    [refresh, showError],
  );

  const reorderProjects = useCallback(
    (serverId: string, ids: string[]) => {
      setProjects((prev) => {
        const own = prev.filter((p) => p.serverId === serverId);
        const index = new Map(ids.map((id, i) => [id, i]));
        const ordered = [...own].sort(
          (a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0),
        );
        let next = 0;
        return prev.map((p) => (p.serverId === serverId ? ordered[next++] : p));
      });
      void window.plantar.reorderProjects(serverId, ids).then((result) => {
        if (!result.ok) {
          showError(result.error);
          void refresh();
        }
      });
    },
    [refresh, showError],
  );

  // Клик по «+» у сервера — выбор источника проекта (папка или репозиторий)
  const [addingForServer, setAddingForServer] = useState<string | null>(null);

  // Источник выбран — показываем экран подтверждения настроек перед добавлением
  const [newProject, setNewProject] = useState<{
    serverId: string;
    path: string;
    initial: Partial<ProjectConfigInput>;
    note: string;
    source: "local" | "git";
    repoUrl?: string;
    branch?: string;
  } | null>(null);

  function noteFor(config: unknown, framework: string | null): string {
    return config
      ? t("app.settingsFromConfig")
      : `${
          framework
            ? t("app.frameworkDetected", { framework })
            : t("app.settingsAutoDetected")
        }${t("app.checkAndAdd")}`;
  }

  async function pickLocalProject(serverId: string) {
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
      source: "local",
      initial: config ?? detected.config,
      note: noteFor(config, detected.framework),
    });
  }

  async function removeServer(server: ServerRecord) {
    if (!window.confirm(t("app.confirmRemoveServer", { name: server.name })))
      return;
    await window.plantar.removeServer(server.id);
    if (selection?.id === server.id) setSelection(null);
    await refresh();
  }

  // Проект, для которого открыт диалог удаления (из списка или с сервера)
  const [removingProject, setRemovingProject] = useState<ProjectRecord | null>(
    null,
  );

  // Сервер, на котором открыт поиск запущенных приложений («Найдено на сервере»)
  const [discoverFor, setDiscoverFor] = useState<ServerRecord | null>(null);

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
  const [tab, setTab] = useState("status");
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
    setTab("status");
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

  // Обновляет список проектов и конфиг открытого проекта — после привязки
  // папки с кодом или репозитория
  const refreshProject = useCallback(async () => {
    await refresh();
    if (!selectedProjectId) return;
    const result = await window.plantar.readProjectConfig(selectedProjectId);
    if (result.ok) setProjectConfig(result.data);
  }, [refresh, selectedProjectId]);

  // Завершение деплоя (любого проекта) — обновляем список и конфиг открытого
  // проекта. Событие из main, а не колбэк вкладки: деплой переживает
  // навигацию, и колбэк размонтированной вкладки обновил бы чужой конфиг
  useEffect(() => {
    return window.plantar.onDeployFinished(({ projectId }) => {
      void refresh();
      if (projectId !== selectedProjectId) return;
      void window.plantar.readProjectConfig(projectId).then((result) => {
        if (result.ok) setProjectConfig(result.data);
      });
    });
  }, [refresh, selectedProjectId]);

  return (
    <div className="flex h-screen">
      {/* Зона перетаскивания окна на всю ширину; интерактивным элементам поверх неё нужен no-drag */}
      <div className="fixed inset-x-0 top-0 h-10 [-webkit-app-region:drag]" />
      <Sidebar
        servers={servers}
        projects={projects}
        selection={selection}
        statuses={statuses}
        activeDeploys={activeDeploys}
        refreshingStatuses={statusesRefreshing}
        onRefreshStatuses={() => void refreshStatuses()}
        onSelect={setSelection}
        onAddServer={() => setAddServerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onAddProject={setAddingForServer}
        onRemoveServer={removeServer}
        onRemoveProject={setRemovingProject}
        onReorderServers={reorderServers}
        onReorderProjects={reorderProjects}
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
              <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="shrink-0 text-lg font-bold">{selectedProject.name}</h1>
                {selectedProject.external && (
                  <span
                    title={t("app.externalBadgeHint")}
                    className="shrink-0 self-center rounded-full bg-amber-bg px-2 py-0.5 text-[11px] font-semibold text-soil"
                  >
                    {t("app.externalBadge")}
                  </span>
                )}
                <span className="truncate font-mono text-[12px] text-ink-soft">
                  {projectServer.name} ·{" "}
                  {selectedProject.source === "git"
                    ? (selectedProject.repoUrl ?? selectedProject.path)
                    : selectedProject.path ||
                      selectedProject.external?.appDir ||
                      ""}
                </span>
              </div>
              <div className="mt-3 flex items-center">
                <TabsList>
                  <TabsTrigger className="px-4" value="status">
                    {t("app.tabStatus")}
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="deploy">
                    {t("app.tabDeploy")}
                  </TabsTrigger>
                  {selectedProject.source === "git" && (
                    <TabsTrigger className="px-4" value="commits">
                      {t("app.tabCommits")}
                    </TabsTrigger>
                  )}
                  <TabsTrigger className="px-4" value="env">
                    {t("app.tabEnv")}
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="logs">
                    {t("app.tabLogs")}
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="files">
                    {t("app.tabFiles")}
                  </TabsTrigger>
                  <TabsTrigger className="px-4" value="history">
                    {t("app.tabHistory")}
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
                  {t("app.projectSettings")}
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
                  onProjectChanged={refreshProject}
                />
              </TabsContent>
              {selectedProject.source === "git" && (
                <TabsContent value="commits" className="h-full">
                  <CommitsTab
                    project={selectedProject}
                    server={projectServer}
                    askPassword={askPassword}
                  />
                </TabsContent>
              )}
              <TabsContent value="env" className="h-full">
                <EnvTab
                  project={selectedProject}
                  server={projectServer}
                  askPassword={askPassword}
                />
              </TabsContent>
              <TabsContent value="status" className="h-full">
                <AppStatusTab
                  project={selectedProject}
                  server={projectServer}
                  config={projectConfig}
                  askPassword={askPassword}
                  onOpenServer={() =>
                    setSelection({ kind: "server", id: projectServer.id })
                  }
                  onDeploy={() => {
                    setTab("deploy");
                    setAutoDeploy(true);
                  }}
                />
              </TabsContent>
              <TabsContent value="logs" className="h-full">
                <LogsTab
                  project={selectedProject}
                  server={projectServer}
                  config={projectConfig}
                  askPassword={askPassword}
                />
              </TabsContent>
              <TabsContent value="files" className="h-full">
                <FilesTab
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
              <div className="flex items-center gap-3">
                <h1 className="min-w-0 truncate text-lg font-bold">
                  {selectedServer.name}
                </h1>
                {/* Кнопка попадает под полосу перетаскивания окна: полоса — отдельный
                    элемент поверх шапки, поэтому нужен и no-drag, и z-10 — иначе клики
                    по верхней части кнопки молча достаются полосе */}
                <Button
                  variant="outline"
                  size="sm"
                  className="relative z-10 ml-auto shrink-0 [-webkit-app-region:no-drag]"
                  onClick={() => setDiscoverFor(selectedServer)}
                >
                  <Radar />
                  {t("app.discoverApps")}
                </Button>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                {t("app.serverHint")}
              </p>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 thin-scroll">
              <div className="flex flex-col gap-4 pb-4">
                <StatusTab server={selectedServer} askPassword={askPassword} />
                <ServerMonitoring
                  key={selectedServer.id}
                  server={selectedServer}
                  askPassword={askPassword}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm text-center">
              <Sprout className="mx-auto size-9 text-sage" />
              <h2 className="mt-3 text-[16px] font-bold">
                {servers.length === 0
                  ? t("app.emptyAddServer")
                  : t("app.emptySelect")}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                {servers.length === 0
                  ? t("app.emptyAddServerHint")
                  : t("app.emptySelectHint")}
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
          title={t("app.projectSettings")}
          folderPath={
            selectedProject.source === "git"
              ? (selectedProject.repoUrl ?? selectedProject.path)
              : selectedProject.path ||
                selectedProject.external?.appDir ||
                ""
          }
          initial={projectConfig ?? {}}
          repoRoot={
            selectedProject.source === "git" ? selectedProject.path : undefined
          }
          initialSubdir={selectedProject.subdir}
          repoUrl={
            selectedProject.source === "git" ? selectedProject.repoUrl : undefined
          }
          initialBranch={selectedProject.branch}
          submitLabel={t("common.save")}
          savedMessage={settingsSaved ? t("app.settingsSaved") : undefined}
          onDeploy={() => {
            setProjectSettingsOpen(false);
            setSettingsSaved(false);
            setTab("deploy");
            setAutoDeploy(true);
          }}
          onSubmit={async (input, subdir, branch) => {
            // Ветку меняем до записи конфига: подпапка и plantar.json
            // должны примениться уже к новой ветке
            if (branch) {
              const switched = await window.plantar.setProjectBranch(
                selectedProject.id,
                branch,
              );
              if (!switched.ok) return switched.error;
            }
            const result = await window.plantar.writeProjectConfig(
              selectedProject.id,
              input,
              subdir,
            );
            if (!result.ok) return result.error;
            const changed =
              Boolean(branch) ||
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

      <AddProjectDialog
        open={addingForServer !== null}
        onOpenChange={(open) => !open && setAddingForServer(null)}
        onPickLocal={() => {
          const serverId = addingForServer;
          setAddingForServer(null);
          if (serverId) void pickLocalProject(serverId);
        }}
        onCloned={(result, repoUrl, branch) => {
          const serverId = addingForServer;
          setAddingForServer(null);
          if (!serverId) return;
          const { path, config, detected } = result;
          setNewProject({
            serverId,
            path,
            source: "git",
            repoUrl,
            branch,
            initial: config ?? detected.config,
            note: noteFor(config, detected.framework),
          });
        }}
      />

      <ProjectSettingsDialog
        open={newProject !== null}
        onOpenChange={(open) => {
          if (open) return;
          // Форму закрыли без добавления — убираем осиротевший клон репозитория
          if (newProject?.source === "git") {
            void window.plantar.cancelClone(newProject.path);
          }
          setNewProject(null);
        }}
        title={t("app.newProject")}
        folderPath={
          newProject
            ? (newProject.source === "git"
                ? (newProject.repoUrl ?? newProject.path)
                : newProject.path)
            : ""
        }
        initial={newProject?.initial ?? {}}
        note={newProject?.note}
        repoRoot={newProject?.source === "git" ? newProject.path : undefined}
        submitLabel={t("app.addProject")}
        onSubmit={async (config, subdir) => {
          if (!newProject) return null;
          const result = await window.plantar.addProject({
            serverId: newProject.serverId,
            path: newProject.path,
            config,
            subdir,
            source: newProject.source,
            repoUrl: newProject.repoUrl,
            branch: newProject.branch,
          });
          if (!result.ok) return result.error;
          setNewProject(null);
          await refresh();
          setSelection({ kind: "project", id: result.data.id });
          return null;
        }}
      />

      <DiscoverAppsDialog
        server={discoverFor}
        askPassword={askPassword}
        onClose={() => setDiscoverFor(null)}
        onImported={() => void refresh()}
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
