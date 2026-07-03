import { FolderPlus, Package, Plus, Server, Settings, Sprout, Trash2 } from "lucide-react";
import type { ProjectRecord, ServerRecord } from "../../../preload/index.d";
import type { Selection } from "../app";
import { cn } from "../lib/utils";

interface Props {
  servers: ServerRecord[];
  projects: ProjectRecord[];
  selection: Selection;
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
  onSelect,
  onAddServer,
  onAddProject,
  onRemoveServer,
  onRemoveProject,
  onOpenSettings,
}: Props) {
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-pine text-sage">
      {/* Зона перетаскивания окна под скрытым тайтлбаром macOS */}
      <div className="h-10 shrink-0 [-webkit-app-region:drag]" />

      <div className="flex items-center gap-2 px-4 pb-4">
        <Sprout className="size-5 text-sprout" />
        <span className="text-[15px] font-bold tracking-wide text-white">Plantar</span>
      </div>

      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-bold tracking-[0.14em] text-sage/60 uppercase">
          Серверы
        </span>
        <button
          onClick={onAddServer}
          title="Добавить сервер"
          className="rounded-md p-1 text-sage/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sprout/50"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <nav className="thin-scroll flex-1 overflow-y-auto px-2 pb-2">
        {servers.length === 0 && (
          <p className="px-2 py-3 text-[12.5px] leading-relaxed text-sage/60">
            Пока пусто. Добавь первый сервер — понадобятся IP и пароль от хостинга.
          </p>
        )}

        {servers.map((server) => {
          const serverProjects = projects.filter((p) => p.serverId === server.id);
          const serverActive = selection?.kind === "server" && selection.id === server.id;
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
                  title="Добавить проект"
                  className="hidden rounded p-0.5 text-sage/70 group-hover:block hover:text-white"
                >
                  <FolderPlus className="size-3.5" />
                </button>
                <button
                  onClick={() => onRemoveServer(server)}
                  title="Удалить сервер"
                  className="hidden rounded p-0.5 text-sage/70 group-hover:block hover:text-clay"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {serverProjects.map((project) => {
                const active = selection?.kind === "project" && selection.id === project.id;
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
                      title="Убрать проект из списка"
                      className="hidden rounded p-0.5 text-sage/70 group-hover:block hover:text-clay"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
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
          Настройки
        </button>
      </div>
    </aside>
  );
}
