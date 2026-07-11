import {
  FolderPlus,
  Package,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Sprout,
  Trash2,
} from "lucide-react";
import type { Language } from "@plantar/storage";
import type { AppStatus, ProjectRecord, ServerRecord } from "../../../preload/index.d";
import type { Selection } from "../app";
import { useI18n } from "../i18n";
import type { ServerAppStatuses } from "../lib/use-app-statuses";
import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

function formatChecked(iso: string, lang: Language): string {
  return new Date(iso).toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SERVER_DOT: Record<ServerAppStatuses["kind"], string> = {
  checking: "animate-pulse bg-sage/50",
  ok: "bg-sprout",
  unreachable: "bg-clay",
  needsPassword: "border border-sage/50",
};

/** Статус проекта в сайдбаре; static не показывается — живой проверки для него нет */
type ProjectDotKind = Exclude<AppStatus, "static"> | "unknown" | "checking";

const PROJECT_DOT: Record<ProjectDotKind, string> = {
  running: "bg-sprout",
  stopped: "bg-sage/50",
  error: "bg-clay",
  unknown: "border border-sage/50",
  checking: "animate-pulse bg-sage/50",
};

/** Статус приложения проекта из снимка сервера; нет данных — неизвестен */
function projectDotKind(
  server: ServerAppStatuses | undefined,
  projectId: string,
): AppStatus | "unknown" | "checking" {
  if (!server) return "checking";
  const status = server.apps[projectId];
  if (status) return status;
  return server.kind === "checking" ? "checking" : "unknown";
}

interface Props {
  servers: ServerRecord[];
  projects: ProjectRecord[];
  selection: Selection;
  statuses: Record<string, ServerAppStatuses>;
  refreshingStatuses: boolean;
  onRefreshStatuses: () => void;
  onSelect: (selection: Selection) => void;
  onAddServer: () => void;
  onAddProject: (serverId: string) => void;
  onRemoveServer: (server: ServerRecord) => void;
  onRemoveProject: (project: ProjectRecord) => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  servers,
  projects,
  selection,
  statuses,
  refreshingStatuses,
  onRefreshStatuses,
  onSelect,
  onAddServer,
  onAddProject,
  onRemoveServer,
  onRemoveProject,
  onOpenSettings,
}: Props) {
  const { t, lang } = useI18n();
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-pine text-sage">
      {/* Отступ под кнопки-светофоры macOS; зона перетаскивания — общая полоса в app.tsx */}
      <div className="h-10 shrink-0" />

      <div className="flex items-center gap-2 px-4 pb-4">
        <Sprout className="size-5 text-sprout" />
        <span className="text-[15px] font-bold tracking-wide text-white">Plantar</span>
      </div>

      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-bold tracking-[0.14em] text-sage/60 uppercase">
          {t("sidebar.servers")}
        </span>
        <div className="flex items-center gap-0.5">
          {servers.length > 0 && (
            <button
              onClick={onRefreshStatuses}
              disabled={refreshingStatuses}
              title={t("sidebar.status.refresh")}
              className="rounded-md p-1 text-sage/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sprout/50"
            >
              <RefreshCw className={cn("size-3.5", refreshingStatuses && "animate-spin")} />
            </button>
          )}
          <button
            onClick={onAddServer}
            title={t("sidebar.addServer")}
            className="rounded-md p-1 text-sage/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sprout/50"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <nav className="thin-scroll flex-1 overflow-y-auto px-2 pb-2">
        {servers.length === 0 && (
          <p className="px-2 py-3 text-[12.5px] leading-relaxed text-sage/60">
            {t("sidebar.empty")}
          </p>
        )}

        {servers.map((server) => {
          const serverProjects = projects.filter((p) => p.serverId === server.id);
          const serverActive = selection?.kind === "server" && selection.id === server.id;
          const status = statuses[server.id];
          const checkedSuffix = status?.checkedAt
            ? ` · ${t("sidebar.status.checkedAt", { time: formatChecked(status.checkedAt, lang) })}`
            : "";
          return (
            <div key={server.id} className="mb-1">
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2 py-1.5",
                  serverActive ? "bg-white/12 text-white" : "hover:bg-white/6",
                )}
              >
                <button
                  onClick={() => onSelect({ kind: "server", id: server.id })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sprout/50"
                >
                  <Server className="size-4 shrink-0 text-sage/80" />
                  <span className="truncate text-[13px] font-semibold">{server.name}</span>
                </button>
                <button
                  onClick={() => onAddProject(server.id)}
                  title={t("sidebar.addProject")}
                  className="hidden rounded p-0.5 text-sage/70 group-hover:block hover:text-white"
                >
                  <FolderPlus className="size-3.5" />
                </button>
                <button
                  onClick={() => onRemoveServer(server)}
                  title={t("sidebar.removeServer")}
                  className="hidden rounded p-0.5 text-sage/70 group-hover:block hover:text-clay"
                >
                  <Trash2 className="size-3.5" />
                </button>
                {/* Точка всегда видима (кнопки появляются слева от неё) — иначе
                    подсказку при наведении было бы не прочитать */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          SERVER_DOT[status?.kind ?? "checking"],
                        )}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t(`sidebar.status.server.${status?.kind ?? "checking"}`) + checkedSuffix}
                  </TooltipContent>
                </Tooltip>
              </div>

              {serverProjects.map((project) => {
                const active = selection?.kind === "project" && selection.id === project.id;
                const dot = projectDotKind(status, project.id);
                return (
                  <div
                    key={project.id}
                    className={cn(
                      "group ml-4 flex items-center gap-2 rounded-lg px-2 py-1.5",
                      active ? "bg-sprout/15 text-white" : "hover:bg-white/6",
                    )}
                  >
                    <button
                      onClick={() => onSelect({ kind: "project", id: project.id })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sprout/50"
                    >
                      <Package
                        className={cn("size-3.5 shrink-0", active ? "text-sprout" : "text-sage/60")}
                      />
                      <span className="truncate text-[13px]">{project.name}</span>
                    </button>
                    <button
                      onClick={() => onRemoveProject(project)}
                      title={t("sidebar.removeProject")}
                      className="hidden rounded p-0.5 text-sage/70 group-hover:block hover:text-clay"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    {dot !== "static" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex size-3.5 shrink-0 items-center justify-center">
                            <span className={cn("size-2 rounded-full", PROJECT_DOT[dot])} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {t(`sidebar.status.${dot}`) + checkedSuffix}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-pine-edge px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-sage/80 outline-none hover:bg-pine-edge/50 hover:text-sage focus-visible:ring-2 focus-visible:ring-sprout/50"
        >
          <Settings className="size-4" />
          {t("sidebar.settings")}
        </button>
      </div>
    </aside>
  );
}
