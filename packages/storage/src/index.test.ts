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
  listDeployLogs,
  matchesProject,
  readCommitsCache,
  readHistory,
  readProjects,
  readServers,
  readSettings,
  readStatusTabCache,
  writeProjects,
  writeServers,
  writeSettings,
  type DeployRecord,
  type ProjectRecord,
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

function seedHistory(records: DeployRecord[]): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), "history.json"), JSON.stringify(records));
}

function server(id: string): ServerRecord {
  return { id, name: id, host: "1.2.3.4", port: 22, user: "root", auth: "key" };
}

function deploy(project: string, projectId?: string): DeployRecord {
  return {
    project,
    ...(projectId ? { projectId } : {}),
    host: "1.2.3.4",
    startedAt: "2026-07-12T10:00:00.000Z",
    finishedAt: "2026-07-12T10:01:00.000Z",
    status: "success",
    logFile: `/data/logs/${project}/deploy-2026-07-12T10-00-00-000Z.log`,
  };
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "prj-1",
    serverId: "srv-1",
    name: "site-new",
    path: "/code/site",
    ...overrides,
  };
}

function writeLog(projectName: string, file: string): string {
  const dir = path.join(dataDir(), "logs", projectName);
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  writeFileSync(full, "");
  return full;
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

  it("история проекта не растёт бесконечно: остаются последние 200 записей", () => {
    const existing = Array.from({ length: 300 }, (_, i) => ({
      ...deploy("site-a"),
      startedAt: `run-${i}`,
    }));
    seedHistory(existing);

    appendHistory(deploy("site-a"));

    const history = readHistory();
    expect(history).toHaveLength(200);
    expect(history[0].startedAt).toBe("run-101");
    expect(history.at(-1)?.startedAt).toBe("2026-07-12T10:00:00.000Z");
  });

  it("активный проект не вытесняет историю остальных", () => {
    seedHistory([
      deploy("site-rare"),
      ...Array.from({ length: 300 }, () => deploy("site-busy")),
    ]);

    appendHistory(deploy("site-busy"));

    const history = readHistory();
    expect(history.filter((r) => r.project === "site-rare")).toHaveLength(1);
    expect(history.filter((r) => r.project === "site-busy")).toHaveLength(200);
    // Порядок записей сохраняется: старейшая уцелевшая — по-прежнему первая
    expect(history[0].project).toBe("site-rare");
  });

  it("один проект на двух серверах: истории не вытесняют друг друга", () => {
    seedHistory([
      { ...deploy("site"), host: "5.6.7.8" },
      ...Array.from({ length: 300 }, () => deploy("site")),
    ]);

    appendHistory(deploy("site"));

    expect(readHistory().filter((r) => r.host === "5.6.7.8")).toHaveLength(1);
  });
});

describe("история переименованного проекта", () => {
  const identity = {
    projectId: "prj-1",
    names: ["site-new", "site-old"],
    host: "1.2.3.4",
  };

  it("записи до переименования находятся по id проекта", () => {
    expect(matchesProject(deploy("site-old", "prj-1"), identity)).toBe(true);
  });

  it("запись другого проекта под тем же именем не подхватывается", () => {
    expect(matchesProject(deploy("site-new", "prj-2"), identity)).toBe(false);
  });

  it("запись без id (CLI, старый формат) находится по имени и адресу сервера", () => {
    expect(matchesProject(deploy("site-new"), identity)).toBe(true);
    expect(matchesProject(deploy("site-old"), identity)).toBe(true);
    expect(matchesProject(deploy("site-other"), identity)).toBe(false);
    expect(matchesProject({ ...deploy("site-new"), host: "5.6.7.8" }, identity)).toBe(
      false,
    );
  });

  it("логи собираются из папок всех имён проекта, от старых к новым", () => {
    const older = writeLog("site-old", "deploy-2026-07-11T10-00-00-000Z.log");
    const newer = writeLog("site-new", "deploy-2026-07-12T10-00-00-000Z.log");
    writeLog("site-old", "nginx-access.log");

    expect(listDeployLogs(["site-new", "site-old"])).toEqual([older, newer]);
  });

  it("папка без логов и повторное имя не мешают", () => {
    const file = writeLog("site-new", "deploy-2026-07-12T10-00-00-000Z.log");
    expect(listDeployLogs(["site-new", "site-new", "site-gone"])).toEqual([file]);
  });

  it("переименование не делит историю проекта на две группы по лимиту", () => {
    writeServers([server("srv-1")]);
    writeProjects([project({ previousNames: ["site-old"] })]);
    seedHistory([
      // Прогоны до переименования: из CLI (без id) и из приложения (с id)
      ...Array.from({ length: 150 }, () => deploy("site-old")),
      ...Array.from({ length: 150 }, () => deploy("site-old", "prj-1")),
    ]);

    appendHistory(deploy("site-new", "prj-1"));

    expect(readHistory()).toHaveLength(200);
  });
});
