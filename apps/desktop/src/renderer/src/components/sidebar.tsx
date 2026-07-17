import {
  ChevronRight,
  FolderPlus,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sprout,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Language } from "@plantar/storage";
import type {
  AppStatus,
  DeployStartedEvent,
  ProjectRecord,
  ServerRecord,
} from "../../../preload/index.d";
import type { Selection } from "../app";
import { useI18n } from "../i18n";
import { fuzzyMatch } from "../lib/fuzzy";
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

/** Статус проекта в сайдбаре; static не показывается — сайт ещё не проверялся */
type ProjectDotKind = Exclude<AppStatus, "static"> | "unknown" | "checking";

const PROJECT_DOT: Record<ProjectDotKind, string> = {
  running: "bg-sprout",
  stopped: "bg-sage/50",
  error: "bg-clay",
  unresponsive: "bg-clay",
  unknown: "border border-sage/50",
  checking: "animate-pulse bg-sage/50",
};

/** Перетаскиваемый элемент сайдбара: сервер или проект в пределах своего сервера */
type DragItem =
  | { kind: "server"; id: string }
  | { kind: "project"; id: string; serverId: string };

/** Куда вставится перетаскиваемое: номер промежутка между строками (0..length).
 *  «После N» и «перед N+1» — один промежуток, поэтому и линия-индикатор одна */
type DropTarget =
  | { kind: "server"; gap: number }
  | { kind: "project"; serverId: string; gap: number };

/** Новый порядок ids: dragged вставляется в промежуток gap */
function moveId(ids: string[], dragged: string, gap: number): string[] {
  const from = ids.indexOf(dragged);
  const without = ids.filter((id) => id !== dragged);
  const at = from !== -1 && from < gap ? gap - 1 : gap;
  return [...without.slice(0, at), dragged, ...without.slice(at)];
}

/** Промежуток, на который указывает курсор над строкой index: до или после неё */
function gapAt(e: React.DragEvent<HTMLDivElement>, index: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY > rect.top + rect.height / 2 ? index + 1 : index;
}

// Прямая линия в зазоре между строками (тень не годится — повторяет скругление
// углов строки); смещение у групп больше — между ними 4px внешнего отступа
const GROUP_LINE_TOP =
  "before:absolute before:inset-x-0 before:-top-[3px] before:h-0.5 before:rounded-full before:bg-sprout";
const GROUP_LINE_BOTTOM =
  "after:absolute after:inset-x-0 after:-bottom-[3px] after:h-0.5 after:rounded-full after:bg-sprout";
const ROW_LINE_TOP =
  "before:absolute before:inset-x-0 before:-top-[1px] before:h-0.5 before:rounded-full before:bg-sprout";
const ROW_LINE_BOTTOM =
  "after:absolute after:inset-x-0 after:-bottom-[1px] after:h-0.5 after:rounded-full after:bg-sprout";

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
  /** projectId → вид идущего прогона; спиннер вместо иконки проекта */
  activeDeploys: Record<string, DeployStartedEvent["kind"]>;
  refreshingStatuses: boolean;
  onRefreshStatuses: () => void;
  onSelect: (selection: Selection) => void;
  onAddServer: () => void;
  onAddProject: (serverId: string) => void;
  onRemoveServer: (server: ServerRecord) => void;
  onRemoveProject: (project: ProjectRecord) => void;
  onReorderServers: (ids: string[]) => void;
  onReorderProjects: (serverId: string, ids: string[]) => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  servers,
  projects,
  selection,
  statuses,
  activeDeploys,
  refreshingStatuses,
  onRefreshStatuses,
  onSelect,
  onAddServer,
  onAddProject,
  onRemoveServer,
  onRemoveProject,
  onReorderServers,
  onReorderProjects,
  onOpenSettings,
}: Props) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Перетаскивание: источник и промежуток, куда вставится элемент
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // dragover сыплется непрерывно — не пересоздаём state, если позиция не изменилась
  function setTarget(next: DropTarget) {
    setDropTarget((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }

  function toggleCollapsed(serverId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  }

  function expand(serverId: string) {
    setCollapsed((prev) => {
      if (!prev.has(serverId)) return prev;
      const next = new Set(prev);
      next.delete(serverId);
      return next;
    });
  }

  // При поиске: совпал сервер — показываем его со всеми проектами,
  // совпали только проекты — показываем сервер с совпавшими; иначе сервер скрыт.
  const search = query.trim();
  const visibleServers = servers
    .map((server) => {
      const serverProjects = projects.filter((p) => p.serverId === server.id);
      if (!search || fuzzyMatch(search, server.name)) return { server, serverProjects };
      const matched = serverProjects.filter((p) => fuzzyMatch(search, p.name));
      return matched.length > 0 ? { server, serverProjects: matched } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

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

      {servers.length > 0 && (
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-sage/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("sidebar.search.placeholder")}
              className="w-full rounded-md bg-white/5 py-1.5 pr-2 pl-7 text-[12.5px] text-white placeholder:text-sage/50 outline-none focus-visible:ring-2 focus-visible:ring-sprout/50"
            />
          </div>
        </div>
      )}

      {/* pt-1 — место под линию-индикатор перетаскивания над первым сервером,
          иначе её обрезает скролл-контейнер */}
      <nav className="thin-scroll flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {servers.length === 0 && (
          <p className="px-2 py-3 text-[12.5px] leading-relaxed text-sage/60">
            {t("sidebar.empty")}
          </p>
        )}
        {servers.length > 0 && visibleServers.length === 0 && (
          <p className="px-2 py-3 text-[12.5px] leading-relaxed text-sage/60">
            {t("sidebar.search.empty")}
          </p>
        )}

        {visibleServers.map(({ server, serverProjects }, serverIndex) => {
          const serverActive = selection?.kind === "server" && selection.id === server.id;
          // Линия промежутка g рисуется над группой g; последний промежуток —
          // под последней группой
          const serverLine =
            dropTarget?.kind === "server"
              ? dropTarget.gap === serverIndex
                ? "top"
                : serverIndex === visibleServers.length - 1 &&
                    dropTarget.gap === visibleServers.length
                  ? "bottom"
                  : null
              : null;
          const status = statuses[server.id];
          const checkedSuffix = status?.checkedAt
            ? ` · ${t("sidebar.status.checkedAt", { time: formatChecked(status.checkedAt, lang) })}`
            : "";
          // Во время поиска аккордион не действует — совпавшие проекты всегда видны
          const isCollapsed = !search && collapsed.has(server.id);
          return (
            // Сервер перетаскивается вместе со своими проектами, поэтому цель
            // сброса и линия-индикатор — вся группа, а не только строка сервера
            <div
              key={server.id}
              className={cn(
                "relative mb-1",
                serverLine === "top" && GROUP_LINE_TOP,
                serverLine === "bottom" && GROUP_LINE_BOTTOM,
              )}
              onDragOver={(e) => {
                if (dragging?.kind !== "server" || dragging.id === server.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setTarget({ kind: "server", gap: gapAt(e, serverIndex) });
              }}
              onDrop={(e) => {
                if (dragging?.kind !== "server" || dragging.id === server.id) return;
                e.preventDefault();
                onReorderServers(
                  moveId(
                    servers.map((s) => s.id),
                    dragging.id,
                    gapAt(e, serverIndex),
                  ),
                );
                setDragging(null);
                setDropTarget(null);
              }}
            >
              <div
                draggable={!search}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", server.name);
                  setDragging({ kind: "server", id: server.id });
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2 py-1.5",
                  serverActive ? "bg-white/12 text-white" : "hover:bg-white/6",
                  dragging?.id === server.id && "opacity-50",
                )}
              >
                {serverProjects.length > 0 ? (
                  <button
                    onClick={() => toggleCollapsed(server.id)}
                    title={t(isCollapsed ? "sidebar.expandProjects" : "sidebar.collapseProjects")}
                    className="shrink-0 rounded p-0.5 text-sage/60 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-sprout/50"
                  >
                    <ChevronRight
                      className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")}
                    />
                  </button>
                ) : (
                  <span className="size-4.5 shrink-0" />
                )}
                <button
                  onClick={() => onSelect({ kind: "server", id: server.id })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sprout/50"
                >
                  <Server className="size-4 shrink-0 text-sage/80" />
                  <span className="truncate text-[13px] font-semibold">{server.name}</span>
                </button>
                <button
                  onClick={() => {
                    expand(server.id);
                    onAddProject(server.id);
                  }}
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

              {!isCollapsed &&
                serverProjects.map((project, projectIndex) => {
                  const active = selection?.kind === "project" && selection.id === project.id;
                  const dot = projectDotKind(status, project.id);
                  const deploying = activeDeploys[project.id];
                  const projectLine =
                    dropTarget?.kind === "project" && dropTarget.serverId === server.id
                      ? dropTarget.gap === projectIndex
                        ? "top"
                        : projectIndex === serverProjects.length - 1 &&
                            dropTarget.gap === serverProjects.length
                          ? "bottom"
                          : null
                      : null;
                  return (
                    <div
                      key={project.id}
                      draggable={!search}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", project.name);
                        setDragging({ kind: "project", id: project.id, serverId: server.id });
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      // Проекты сортируются только внутри своего сервера: перенос
                      // на другой сервер — это смена места деплоя, не порядок
                      onDragOver={(e) => {
                        if (
                          dragging?.kind !== "project" ||
                          dragging.serverId !== server.id ||
                          dragging.id === project.id
                        )
                          return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setTarget({
                          kind: "project",
                          serverId: server.id,
                          gap: gapAt(e, projectIndex),
                        });
                      }}
                      onDrop={(e) => {
                        if (
                          dragging?.kind !== "project" ||
                          dragging.serverId !== server.id ||
                          dragging.id === project.id
                        )
                          return;
                        e.preventDefault();
                        onReorderProjects(
                          server.id,
                          moveId(
                            serverProjects.map((p) => p.id),
                            dragging.id,
                            gapAt(e, projectIndex),
                          ),
                        );
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      className={cn(
                        "group relative ml-6 flex items-center gap-2 rounded-lg px-2 py-1.5",
                        active ? "bg-sprout/15 text-white" : "hover:bg-white/6",
                        dragging?.id === project.id && "opacity-50",
                        projectLine === "top" && ROW_LINE_TOP,
                        projectLine === "bottom" && ROW_LINE_BOTTOM,
                      )}
                    >
                      <button
                        onClick={() => onSelect({ kind: "project", id: project.id })}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sprout/50"
                      >
                        {deploying ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* Спиннер всегда text-sprout: приглушённый цвет невыбранных
                                  проектов прятал бы его, а деплой должно быть видно */}
                              <Loader2 className="size-3.5 shrink-0 animate-spin text-sprout" />
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {t(`sidebar.deploying.${deploying}`)}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Package
                            className={cn(
                              "size-3.5 shrink-0",
                              active ? "text-sprout" : "text-sage/60",
                            )}
                          />
                        )}
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
