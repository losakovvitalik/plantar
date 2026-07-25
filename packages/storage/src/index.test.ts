import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
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
  removeProjectHistory,
  removeProjectLogs,
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

function seedHistory(records: DeployRecord[]): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), "history.json"), JSON.stringify(records));
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

describe("очистка файлов deploy-логов", () => {
  function logPath(project: string, startedAt: string): string {
    return path.join(
      dataDir(),
      "logs",
      project,
      `deploy-${startedAt.replace(/[:.]/g, "-")}.log`,
    );
  }

  function run(project: string, startedAt: string): DeployRecord {
    return {
      ...deploy(project),
      startedAt,
      finishedAt: startedAt,
      logFile: logPath(project, startedAt),
    };
  }

  /** Кладёт файл прогона на диск (историю пишут отдельно); mtime — время прогона */
  function writeLog(project: string, startedAt: string): string {
    const file = logPath(project, startedAt);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "log");
    const time = new Date(startedAt);
    utimesSync(file, time, time);
    return file;
  }

  it("файл вытесненной записи удаляется с диска", () => {
    const evicted = writeLog("site-a", "2026-07-01T10:00:00.000Z");
    const survivor = writeLog("site-a", "2026-07-09T10:00:00.000Z");
    seedHistory([
      run("site-a", "2026-07-01T10:00:00.000Z"),
      ...Array.from({ length: 199 }, (_, i) =>
        run("site-a", `2026-07-02T10:00:00.${String(i).padStart(3, "0")}Z`),
      ),
    ]);

    appendHistory(run("site-a", "2026-07-09T10:00:00.000Z"));

    expect(existsSync(evicted)).toBe(false);
    expect(existsSync(survivor)).toBe(true);
  });

  it("свежий файл без записи остаётся: это прерванный прогон", () => {
    seedHistory([]);
    const interrupted = writeLog("site-a", "2026-07-12T11:00:00.000Z");

    appendHistory(run("site-a", "2026-07-12T10:00:00.000Z"));

    expect(existsSync(interrupted)).toBe(true);
  });

  it("снимки серверных логов не удаляются", () => {
    seedHistory([]);
    const orphan = writeLog("site-a", "2026-07-01T10:00:00.000Z");
    const access = path.join(path.dirname(orphan), "nginx-access.log");
    const error = path.join(path.dirname(orphan), "nginx-error.log");
    writeFileSync(access, "access");
    writeFileSync(error, "error");

    appendHistory(run("site-a", "2026-07-12T10:00:00.000Z"));

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(access)).toBe(true);
    expect(existsSync(error)).toBe(true);
  });

  it("файл записи с другого сервера остаётся: папка логов у проекта одна", () => {
    const otherHost = writeLog("site", "2026-07-01T10:00:00.000Z");
    seedHistory([{ ...run("site", "2026-07-01T10:00:00.000Z"), host: "5.6.7.8" }]);

    appendHistory(run("site", "2026-07-12T10:00:00.000Z"));

    expect(existsSync(otherHost)).toBe(true);
  });

  it("файл, в который ещё пишут, остаётся, даже если он старее записи", () => {
    seedHistory([]);
    // Второй прогон того же имени (другой сервер или CLI) начался раньше и идёт
    const live = writeLog("site", "2026-07-12T09:00:00.000Z");
    utimesSync(live, new Date(), new Date());

    appendHistory(run("site", "2026-07-12T10:00:00.000Z"));

    expect(readFileSync(live, "utf8")).toBe("log");
  });

  it("прогон, начатый меньше суток назад, остаётся, даже если давно не писал", () => {
    seedHistory([]);
    // Долгая сборка на сервере может ничего не писать в лог часами
    const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const quiet = writeLog("site", startedAt);

    appendHistory(run("site", new Date().toISOString()));

    expect(existsSync(quiet)).toBe(true);
  });

  it("битая история не удаляет логи: по ним ещё можно восстановить записи", () => {
    const orphan = writeLog("site-a", "2026-07-01T10:00:00.000Z");
    corruptStore("history.json");

    appendHistory(run("site-a", "2026-07-12T10:00:00.000Z"));

    expect(existsSync(orphan)).toBe(true);
    expect(existsSync(path.join(dataDir(), "history.json.broken"))).toBe(true);
  });

  it("removeProjectHistory убирает записи проекта, не трогая чужие", () => {
    seedHistory([
      run("site-a", "2026-07-01T10:00:00.000Z"),
      run("site-b", "2026-07-01T10:00:00.000Z"),
    ]);

    removeProjectHistory("site-a");

    expect(readHistory().map((r) => r.project)).toEqual(["site-b"]);
  });

  it("removeProjectLogs убирает папку проекта и не выходит за пределы logs", () => {
    const file = writeLog("site-a", "2026-07-01T10:00:00.000Z");
    const dir = path.dirname(file);
    const repos = path.join(dataDir(), "repos");
    mkdirSync(repos, { recursive: true });

    removeProjectLogs("../repos");
    expect(existsSync(repos)).toBe(true);

    removeProjectLogs("site-a");
    expect(existsSync(dir)).toBe(false);
  });
});
