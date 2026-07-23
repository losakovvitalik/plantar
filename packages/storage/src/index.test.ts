import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendHistory,
  dataDir,
  readCommitsCache,
  readHistory,
  readProjects,
  readServers,
  readSettings,
  readStatusTabCache,
  writeServers,
  writeSettings,
  type DeployRecord,
  type ServerRecord,
} from "./index";

let tmpHome: string;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-storage-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

function corruptStore(file: string, content = '{"broken":'): string {
  mkdirSync(dataDir(), { recursive: true });
  const full = path.join(dataDir(), file);
  writeFileSync(full, content);
  return full;
}

function server(id: string): ServerRecord {
  return { id, name: id, host: "1.2.3.4", port: 22, user: "root", auth: "key" };
}

function deploy(project: string): DeployRecord {
  return {
    project,
    host: "1.2.3.4",
    startedAt: "2026-07-12T10:00:00.000Z",
    finishedAt: "2026-07-12T10:01:00.000Z",
    status: "success",
    logFile: `/data/logs/${project}/deploy-2026-07-12T10-00-00-000Z.log`,
  };
}

describe("чтение битых JSON-хранилищ", () => {
  it("битый settings.json не роняет чтение и даёт настройки по умолчанию", () => {
    corruptStore("settings.json");
    const settings = readSettings();
    expect(settings.saveServerLogCopies).toBe(true);
    expect(settings.notifyOnAppDown).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("битый servers.json деградирует до пустого списка", () => {
    corruptStore("servers.json");
    expect(readServers()).toEqual([]);
  });

  it("битый projects.json деградирует до пустого списка", () => {
    corruptStore("projects.json");
    expect(readProjects()).toEqual([]);
  });

  it("битый commits-cache.json деградирует до пустого кэша", () => {
    corruptStore("commits-cache.json");
    expect(readCommitsCache()).toEqual({});
  });

  it("битый status-tab-cache.json деградирует до пустого кэша", () => {
    corruptStore("status-tab-cache.json");
    expect(readStatusTabCache()).toEqual({});
  });

  it("битый файл сохраняется как .broken для ручного восстановления", () => {
    const full = corruptStore("servers.json", '[{"id": "srv-1"');
    readServers();
    expect(readFileSync(`${full}.broken`, "utf8")).toBe('[{"id": "srv-1"');
  });

  it("валидный JSON не той формы деградирует до пустого списка", () => {
    corruptStore("servers.json", "null");
    expect(readServers()).toEqual([]);
    corruptStore("history.json", '{"not": "a list"}');
    expect(readHistory()).toEqual([]);
  });

  it("существующий .broken не перезаписывается повторным сбоем", () => {
    const full = corruptStore("servers.json", "first-corruption");
    readServers();
    writeFileSync(full, "second-corruption");
    readServers();
    expect(readFileSync(`${full}.broken`, "utf8")).toBe("first-corruption");
  });
});

describe("атомарная запись", () => {
  it("запись и чтение проходят по кругу без временных файлов", () => {
    writeServers([server("srv-1")]);
    writeSettings({ ...readSettings(), letsEncryptEmail: "a@b.c" });
    expect(readServers()).toEqual([server("srv-1")]);
    expect(readSettings().letsEncryptEmail).toBe("a@b.c");
    expect(readdirSync(dataDir()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "сбой записи не трогает прежнее содержимое файла",
    () => {
      writeServers([server("srv-1")]);
      chmodSync(dataDir(), 0o555);
      try {
        expect(() => writeServers([server("srv-2")])).toThrow();
      } finally {
        chmodSync(dataDir(), 0o755);
      }
      expect(readServers()).toEqual([server("srv-1")]);
    },
  );

  it("после неудачной записи временный файл не остаётся", () => {
    // Rename onto a directory fails after the temp file is already written
    mkdirSync(path.join(dataDir(), "servers.json"), { recursive: true });
    expect(() => writeServers([server("srv-1")])).toThrow();
    expect(readdirSync(dataDir()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("appendHistory дописывает записи и переживает битую историю", () => {
    appendHistory(deploy("site-a"));
    appendHistory(deploy("site-b"));
    expect(readHistory().map((r) => r.project)).toEqual(["site-a", "site-b"]);

    corruptStore("history.json");
    appendHistory(deploy("site-c"));
    expect(readHistory().map((r) => r.project)).toEqual(["site-c"]);
  });
});
