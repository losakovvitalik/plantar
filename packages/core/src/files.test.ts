import { describe, expect, it } from "vitest";
import type { SftpDirEntry, SftpEntryStat, SshConnection } from "@plantar/ssh";
import {
  MAX_VIEW_BYTES,
  getRelatedFiles,
  listProjectDir,
  nginxRelatedPaths,
  readRemoteTextFile,
  resolveProjectPath,
} from "./files";

interface FakeSftp {
  entries?: Record<string, SftpDirEntry[]>;
  stats?: Record<string, SftpEntryStat | null>;
  content?: Buffer;
  reads?: { path: string; offset: number; length: number }[];
}

function fakeConn(fake: FakeSftp): SshConnection {
  return {
    listEntries: (remotePath: string) => {
      const list = fake.entries?.[remotePath];
      return list
        ? Promise.resolve(list)
        : Promise.reject(new Error(`no such dir: ${remotePath}`));
    },
    statEntry: (remotePath: string) => Promise.resolve(fake.stats?.[remotePath] ?? null),
    readFileSlice: (remotePath: string, offset: number, length: number) => {
      fake.reads?.push({ path: remotePath, offset, length });
      return Promise.resolve(fake.content ?? Buffer.alloc(0));
    },
  } as unknown as SshConnection;
}

const dirEntry = (name: string, over: Partial<SftpDirEntry> = {}): SftpDirEntry => ({
  name,
  size: 10,
  mtimeMs: 1_000,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
  ...over,
});

const fileStat = (over: Partial<SftpEntryStat> = {}): SftpEntryStat => ({
  size: 10,
  mtimeMs: 1_000,
  isDirectory: false,
  isFile: true,
  ...over,
});

describe("resolveProjectPath", () => {
  it("пустой путь — сам корень, вложенный — приклеивается к корню", () => {
    expect(resolveProjectPath("/var/www/demo", "")).toBe("/var/www/demo");
    expect(resolveProjectPath("/var/www/demo", "current/dist")).toBe(
      "/var/www/demo/current/dist",
    );
  });

  it("отклоняет выход из папки проекта", () => {
    expect(() => resolveProjectPath("/var/www/demo", "..")).toThrow();
    expect(() => resolveProjectPath("/var/www/demo", "a/../../b")).toThrow();
    expect(() => resolveProjectPath("/var/www/demo", "/etc/passwd")).toThrow();
    expect(() => resolveProjectPath("/var/www/demo", "a\\b")).toThrow();
  });

  it("внутренние .. без выхода из корня допустимы", () => {
    expect(resolveProjectPath("/var/www/demo", "a/../b")).toBe("/var/www/demo/b");
  });
});

describe("listProjectDir", () => {
  it("сортирует: папки, файлы, прочее — по алфавиту внутри групп", async () => {
    const conn = fakeConn({
      entries: {
        "/var/www/demo": [
          dirEntry("b.txt"),
          dirEntry("z", { isDirectory: true, isFile: false }),
          dirEntry("a.sock", { isFile: false }),
          dirEntry("a.txt"),
        ],
      },
    });
    const result = await listProjectDir(conn, "/var/www/demo", "");
    expect(result.map((e) => e.name)).toEqual(["z", "a.txt", "b.txt", "a.sock"]);
    expect(result.map((e) => e.kind)).toEqual(["dir", "file", "file", "other"]);
  });

  it("симлинк классифицируется по цели и получает её размер и дату", async () => {
    const conn = fakeConn({
      entries: {
        "/var/www/demo": [
          dirEntry("current", { isSymlink: true, isFile: false, size: 20 }),
        ],
      },
      stats: {
        "/var/www/demo/current": fileStat({
          isDirectory: true,
          isFile: false,
          size: 4096,
          mtimeMs: 7_000,
        }),
      },
    });
    const [entry] = await listProjectDir(conn, "/var/www/demo", "");
    expect(entry).toEqual({
      name: "current",
      kind: "dir",
      size: 4096,
      mtimeMs: 7_000,
      symlink: true,
    });
  });

  it("битый симлинк остаётся неактивным «прочим»", async () => {
    const conn = fakeConn({
      entries: {
        "/var/www/demo": [dirEntry("broken", { isSymlink: true, isFile: false })],
      },
    });
    const [entry] = await listProjectDir(conn, "/var/www/demo", "");
    expect(entry.kind).toBe("other");
    expect(entry.symlink).toBe(true);
  });

  it("читает папку по пути относительно корня", async () => {
    const conn = fakeConn({ entries: { "/var/www/demo/current/dist": [] } });
    await expect(listProjectDir(conn, "/var/www/demo", "current/dist")).resolves.toEqual([]);
  });
});

describe("readRemoteTextFile", () => {
  it("небольшой файл читается целиком", async () => {
    const fake: FakeSftp = {
      stats: { "/f/a.txt": fileStat({ size: 5 }) },
      content: Buffer.from("hello"),
      reads: [],
    };
    const result = await readRemoteTextFile(fakeConn(fake), "/f/a.txt");
    expect(result).toEqual({ kind: "text", text: "hello", size: 5, truncated: false });
    expect(fake.reads).toEqual([{ path: "/f/a.txt", offset: 0, length: 5 }]);
  });

  it("пустой файл — пустой текст без чтения", async () => {
    const fake: FakeSftp = { stats: { "/f/a.txt": fileStat({ size: 0 }) }, reads: [] };
    const result = await readRemoteTextFile(fakeConn(fake), "/f/a.txt");
    expect(result).toEqual({ kind: "text", text: "", size: 0, truncated: false });
    expect(fake.reads).toEqual([]);
  });

  it("null-байт в начале — файл считается нетекстовым", async () => {
    const fake: FakeSftp = {
      stats: { "/f/a.png": fileStat({ size: 4 }) },
      content: Buffer.from([0x89, 0x00, 0x4e, 0x47]),
    };
    const result = await readRemoteTextFile(fakeConn(fake), "/f/a.png");
    expect(result).toEqual({ kind: "binary", size: 4 });
  });

  it("большой файл: хвост в лимит, начало — с целой строки", async () => {
    const size = 3 * MAX_VIEW_BYTES;
    const fake: FakeSftp = {
      stats: { "/f/big.log": fileStat({ size }) },
      content: Buffer.from("обрывок\nстрока 1\nстрока 2\n"),
      reads: [],
    };
    const result = await readRemoteTextFile(fakeConn(fake), "/f/big.log");
    expect(fake.reads).toEqual([
      { path: "/f/big.log", offset: size - MAX_VIEW_BYTES, length: MAX_VIEW_BYTES },
    ]);
    expect(result).toEqual({
      kind: "text",
      text: "строка 1\nстрока 2\n",
      size,
      truncated: true,
    });
  });

  it("отсутствующий файл и папка — ошибка", async () => {
    const conn = fakeConn({
      stats: { "/f/dir": fileStat({ isDirectory: true, isFile: false }) },
    });
    await expect(readRemoteTextFile(conn, "/f/missing")).rejects.toThrow();
    await expect(readRemoteTextFile(conn, "/f/dir")).rejects.toThrow();
  });
});

describe("связанные файлы nginx", () => {
  it("пути повторяют configureNginx", () => {
    expect(nginxRelatedPaths("demo")).toEqual([
      { id: "conf", path: "/etc/nginx/sites-available/demo.conf" },
      { id: "access", path: "/var/log/nginx/demo.access.log" },
      { id: "error", path: "/var/log/nginx/demo.error.log" },
    ]);
  });

  it("getRelatedFiles: существующие с атрибутами, отсутствующие помечены", async () => {
    const conn = fakeConn({
      stats: {
        "/etc/nginx/sites-available/demo.conf": fileStat({ size: 300, mtimeMs: 5_000 }),
      },
    });
    const result = await getRelatedFiles(conn, "demo");
    expect(result).toEqual([
      {
        id: "conf",
        path: "/etc/nginx/sites-available/demo.conf",
        exists: true,
        size: 300,
        mtimeMs: 5_000,
      },
      { id: "access", path: "/var/log/nginx/demo.access.log", exists: false },
      { id: "error", path: "/var/log/nginx/demo.error.log", exists: false },
    ]);
  });
});
