import { ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";
import type { Language } from "@plantar/storage";
import type { RemoteFileEntry } from "../../../preload/index.d";
import { type Translate, useI18n } from "../i18n";
import { cn } from "../lib/utils";

const DATE_LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

export function formatFileSize(t: Translate, size: number): string {
  if (size < 1024) return t("files.sizeB", { value: size });
  if (size < 1024 ** 2) return t("files.sizeKb", { value: (size / 1024).toFixed(1) });
  if (size < 1024 ** 3) return t("files.sizeMb", { value: (size / 1024 ** 2).toFixed(1) });
  return t("files.sizeGb", { value: (size / 1024 ** 3).toFixed(1) });
}

export function formatFileDate(mtimeMs: number, lang: Language): string {
  return new Date(mtimeMs).toLocaleString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Содержимое раскрытых папок по пути относительно корня; "" — корень */
export type TreeNodes = Map<string, RemoteFileEntry[] | "loading">;

interface Props {
  nodes: TreeNodes;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggleDir: (relPath: string) => void;
  onSelectFile: (relPath: string, entry: RemoteFileEntry) => void;
}

export function FileTree({ nodes, expanded, selectedPath, onToggleDir, onSelectFile }: Props) {
  const { t, lang } = useI18n();

  function renderLevel(relPath: string, depth: number): React.ReactNode {
    const entries = nodes.get(relPath);
    const indent = { paddingLeft: 8 + depth * 14 };
    if (entries === "loading") {
      return (
        <div key={`${relPath}/…`} className="flex items-center gap-2 py-1" style={indent}>
          <RefreshCw className="size-3 animate-spin text-ink-soft/60" />
        </div>
      );
    }
    if (!entries) return null;
    if (entries.length === 0) {
      return (
        <p key={`${relPath}/…`} className="py-1 text-[12px] text-ink-soft/70" style={indent}>
          {t("files.emptyDir")}
        </p>
      );
    }
    return entries.map((entry) => {
      const childPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      const linkBadge = entry.symlink && (
        <span className="shrink-0 rounded-full bg-moss/10 px-1.5 text-[10px] text-moss-deep">
          {t("files.linkBadge")}
        </span>
      );
      if (entry.kind === "dir") {
        const open = expanded.has(childPath);
        return (
          <div key={childPath}>
            <button
              onClick={() => onToggleDir(childPath)}
              style={indent}
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left outline-none hover:bg-moss/8 focus-visible:ring-2 focus-visible:ring-moss/50"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-ink-soft/60 transition-transform",
                  open && "rotate-90",
                )}
              />
              <Folder className="size-4 shrink-0 text-moss" />
              <span className="min-w-0 truncate text-[13px]">{entry.name}</span>
              {linkBadge}
            </button>
            {open && renderLevel(childPath, depth + 1)}
          </div>
        );
      }
      if (entry.kind === "file") {
        return (
          <button
            key={childPath}
            onClick={() => onSelectFile(childPath, entry)}
            style={indent}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left outline-none hover:bg-moss/8 focus-visible:ring-2 focus-visible:ring-moss/50",
              selectedPath === childPath && "bg-moss/10",
            )}
          >
            {/* Ширина иконки с местом шеврона папок — имена стоят в одну линию */}
            <FileText className="ml-[19px] size-4 shrink-0 text-ink-soft/70" />
            <span className="min-w-0 truncate text-[13px]">{entry.name}</span>
            {linkBadge}
            <span className="ml-auto shrink-0 pl-2 text-[11px] whitespace-nowrap text-ink-soft/70">
              {formatFileSize(t, entry.size)} · {formatFileDate(entry.mtimeMs, lang)}
            </span>
          </button>
        );
      }
      // Сокеты, устройства, битые ссылки — показываем, но открыть нельзя
      return (
        <div
          key={childPath}
          style={indent}
          className="flex items-center gap-1.5 py-1 pr-2 opacity-50"
        >
          <FileText className="ml-[19px] size-4 shrink-0 text-ink-soft/70" />
          <span className="min-w-0 truncate text-[13px]">{entry.name}</span>
          {linkBadge}
        </div>
      );
    });
  }

  return <div className="flex flex-col">{renderLevel("", 0)}</div>;
}
