import { FolderTree, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  ProjectConfig,
  ProjectRecord,
  RelatedFile,
  RemoteFileContent,
  RemoteFileEntry,
  ServerRecord,
} from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { FileTree, type TreeNodes, formatFileDate, formatFileSize } from "./file-tree";

const RELATED_LABEL_KEYS = {
  conf: "files.relatedConf",
  access: "files.relatedAccess",
  error: "files.relatedError",
} as const;

type Selection =
  | { kind: "path"; path: string; entry: RemoteFileEntry }
  | { kind: "related"; file: RelatedFile };

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  config: ProjectConfig | null;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

export function FilesTab({ project, server, config, askPassword }: Props) {
  const { t, lang } = useI18n();
  const [nodes, setNodes] = useState<TreeNodes>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [related, setRelated] = useState<RelatedFile[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [content, setContent] = useState<RemoteFileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Показывается до ответа main; сам список всегда строится по данным с сервера
  const rootPath = project.external?.appDir ?? `/var/www/${config?.name ?? project.name}`;
  const rootLoaded = nodes.has("");

  async function loadRoot() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setLoading(true);
    setError(null);
    const [rootResult, relatedResult] = await Promise.all([
      window.plantar.listProjectFiles(project.id, "", password),
      window.plantar.listRelatedFiles(project.id, password),
    ]);
    setLoading(false);
    if (!rootResult.ok) {
      setError(rootResult.error);
      return;
    }
    setNodes(new Map([["", rootResult.data]]));
    setExpanded(new Set());
    setSelected(null);
    setContent(null);
    setRelated(relatedResult.ok ? relatedResult.data : []);
  }

  useEffect(() => {
    // Без запроса пароля (ключ или живое соединение) — грузим сразу, иначе по кнопке
    void canConnectSilently(server).then((ok) => {
      if (ok) void loadRoot();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleDir(relPath: string) {
    if (expanded.has(relPath)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(relPath);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(relPath));
    if (nodes.has(relPath)) return;
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setNodes((prev) => new Map(prev).set(relPath, "loading"));
    const result = await window.plantar.listProjectFiles(project.id, relPath, password);
    if (result.ok) {
      setNodes((prev) => new Map(prev).set(relPath, result.data));
    } else {
      setNodes((prev) => {
        const next = new Map(prev);
        next.delete(relPath);
        return next;
      });
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(relPath);
        return next;
      });
      setError(result.error);
    }
  }

  // Grows on every file open — a late response for a previously selected
  // file is ignored instead of rendering under the current file's name
  const openSessionRef = useRef(0);

  async function open(selection: Selection) {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    // The token is taken after the password gate: a cancelled call must not
    // invalidate the request already in flight
    const session = ++openSessionRef.current;
    setSelected(selection);
    setContent(null);
    setContentLoading(true);
    setError(null);
    const result =
      selection.kind === "path"
        ? await window.plantar.readProjectFile(project.id, selection.path, password)
        : await window.plantar.readRelatedFile(project.id, selection.file.id, password);
    if (openSessionRef.current !== session) return;
    setContentLoading(false);
    if (result.ok) setContent(result.data);
    else setError(result.error);
  }

  const selectedName =
    selected &&
    (selected.kind === "path"
      ? (selected.path.split("/").pop() ?? selected.path)
      : t(RELATED_LABEL_KEYS[selected.file.id]));
  const selectedDetail =
    selected &&
    (selected.kind === "path"
      ? `${formatFileSize(t, selected.entry.size)} · ${formatFileDate(selected.entry.mtimeMs, lang)}`
      : selected.file.path);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {!rootLoaded ? (
        loading ? (
          <p className="text-[13px] text-ink-soft">{t("files.loading")}</p>
        ) : (
          <div>
            <Button onClick={loadRoot} variant="outline" size="sm">
              <RefreshCw />
              {t("files.load")}
            </Button>
            {server.auth === "password" && (
              <p className="mt-2 text-[12.5px] text-ink-soft">{t("files.passwordNeeded")}</p>
            )}
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-h-0 w-80 shrink-0 flex-col gap-2">
            <div className="flex items-center gap-1">
              <span
                title={rootPath}
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft"
              >
                {rootPath}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadRoot}
                disabled={loading}
                className="text-ink-soft"
                title={t("files.refreshTitle")}
              >
                <RefreshCw className={cn(loading && "animate-spin")} />
              </Button>
            </div>
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-card p-2">
              <FileTree
                nodes={nodes}
                expanded={expanded}
                selectedPath={selected?.kind === "path" ? selected.path : null}
                onToggleDir={toggleDir}
                onSelectFile={(path, entry) => void open({ kind: "path", path, entry })}
              />
            </div>
            {related.length > 0 && (
              <div className="rounded-xl border border-line bg-card p-2">
                <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                  {t("files.relatedTitle")}
                </p>
                {related.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => void open({ kind: "related", file })}
                    disabled={!file.exists}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-moss/8 focus-visible:ring-2 focus-visible:ring-moss/50",
                      selected?.kind === "related" && selected.file.id === file.id && "bg-moss/10",
                      !file.exists && "pointer-events-none opacity-50",
                    )}
                  >
                    <span className="min-w-0 truncate text-[13px]">
                      {t(RELATED_LABEL_KEYS[file.id])}
                    </span>
                    <span className="ml-auto shrink-0 pl-2 text-[11px] whitespace-nowrap text-ink-soft/70">
                      {file.exists ? formatFileSize(t, file.size!) : t("files.relatedMissing")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {selected ? (
              <>
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="shrink-0 text-[13px] font-semibold">{selectedName}</span>
                  <span className="min-w-0 truncate font-mono text-[12px] text-ink-soft">
                    {selectedDetail}
                  </span>
                </div>
                {contentLoading && (
                  <p className="text-[13px] text-ink-soft">{t("files.viewerLoading")}</p>
                )}
                {content?.kind === "binary" && (
                  <p className="rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-soil">
                    {t("files.binaryNotice", { size: formatFileSize(t, content.size) })}
                  </p>
                )}
                {content?.kind === "text" && (
                  <>
                    {content.truncated && (
                      <p className="rounded-lg bg-amber-bg px-3 py-2 text-[12.5px] leading-snug text-soil">
                        {t("files.truncatedNotice", { size: formatFileSize(t, content.size) })}
                      </p>
                    )}
                    {content.text === "" ? (
                      <p className="text-[13px] text-ink-soft">{t("files.emptyFile")}</p>
                    ) : (
                      <pre className="thin-scroll min-h-0 flex-1 overflow-auto rounded-xl bg-soil p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-sprout">
                        {content.text}
                      </pre>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <FolderTree className="size-8 text-[#b8bfb8]" />
                <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-soft">
                  {t("files.viewerPlaceholder")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
