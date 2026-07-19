import path from "node:path";
import { type SshConnection } from "@plantar/ssh";
import { t } from "./messages";

export type RemoteFileKind = "dir" | "file" | "other";

export interface RemoteFileEntry {
  name: string;
  /** Симлинк классифицируется по цели; битая ссылка — "other" */
  kind: RemoteFileKind;
  size: number;
  mtimeMs: number;
  symlink: boolean;
}

export type RemoteFileContent =
  | { kind: "text"; text: string; size: number; truncated: boolean }
  | { kind: "binary"; size: number };

export type RelatedFileId = "conf" | "access" | "error";

export interface RelatedFile {
  id: RelatedFileId;
  path: string;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
}

/** Максимум байтов на просмотр; у файла крупнее показываем хвост */
export const MAX_VIEW_BYTES = 1024 * 1024;

/** Null-байт в этом префиксе — признак нетекстового файла */
const BINARY_SNIFF_BYTES = 8192;

/**
 * Абсолютный путь внутри папки проекта. Путь от renderer не считается
 * доверенным: абсолютные, с «\» или выходящие через «..» отклоняются.
 * Это гигиена, а не граница безопасности — симлинки на сервере могут
 * вести наружу, и SSH-пользователь и так читает всё.
 */
export function resolveProjectPath(root: string, relPath: string): string {
  if (relPath === "") return root;
  if (relPath.includes("\\") || path.posix.isAbsolute(relPath)) {
    throw new Error(t("fileOutsideProject"));
  }
  const normalized = path.posix.normalize(relPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(t("fileOutsideProject"));
  }
  return path.posix.join(root, normalized);
}

/** Содержимое папки проекта: папки, затем файлы, затем прочее, по алфавиту */
export async function listProjectDir(
  conn: SshConnection,
  root: string,
  relPath: string,
): Promise<RemoteFileEntry[]> {
  const dir = resolveProjectPath(root, relPath);
  const entries = await conn.listEntries(dir);
  const mapped = await Promise.all(
    entries.map(async (entry): Promise<RemoteFileEntry> => {
      let { size, mtimeMs, isDirectory, isFile } = entry;
      if (entry.isSymlink) {
        const target = await conn.statEntry(path.posix.join(dir, entry.name));
        isDirectory = target?.isDirectory ?? false;
        isFile = target?.isFile ?? false;
        if (target) ({ size, mtimeMs } = target);
      }
      return {
        name: entry.name,
        kind: isDirectory ? "dir" : isFile ? "file" : "other",
        size,
        mtimeMs,
        symlink: entry.isSymlink,
      };
    }),
  );
  const rank: Record<RemoteFileKind, number> = { dir: 0, file: 1, other: 2 };
  return mapped.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
}

/**
 * Текст файла для просмотра. Файл крупнее MAX_VIEW_BYTES читается
 * с хвоста до первой целой строки (для логов хвост — самое полезное).
 */
export async function readRemoteTextFile(
  conn: SshConnection,
  absPath: string,
): Promise<RemoteFileContent> {
  const stat = await conn.statEntry(absPath);
  if (!stat?.isFile) throw new Error(t("fileNotFound"));
  if (stat.size === 0) return { kind: "text", text: "", size: 0, truncated: false };

  const truncated = stat.size > MAX_VIEW_BYTES;
  const offset = truncated ? stat.size - MAX_VIEW_BYTES : 0;
  const buffer = await conn.readFileSlice(absPath, offset, Math.min(stat.size, MAX_VIEW_BYTES));
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { kind: "binary", size: stat.size };
  }

  let text = buffer.toString("utf8");
  if (truncated) {
    // Срез начинается с середины строки — убираем её остаток
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) text = text.slice(firstNewline + 1);
  }
  return { kind: "text", text, size: stat.size, truncated };
}

/** Файлы nginx, связанные с сайтом; пути повторяют configureNginx */
export function nginxRelatedPaths(name: string): { id: RelatedFileId; path: string }[] {
  return [
    { id: "conf", path: `/etc/nginx/sites-available/${name}.conf` },
    { id: "access", path: `/var/log/nginx/${name}.access.log` },
    { id: "error", path: `/var/log/nginx/${name}.error.log` },
  ];
}

export async function getRelatedFiles(
  conn: SshConnection,
  name: string,
): Promise<RelatedFile[]> {
  return Promise.all(
    nginxRelatedPaths(name).map(async ({ id, path: filePath }) => {
      const stat = await conn.statEntry(filePath);
      return stat?.isFile
        ? { id, path: filePath, exists: true, size: stat.size, mtimeMs: stat.mtimeMs }
        : { id, path: filePath, exists: false };
    }),
  );
}
