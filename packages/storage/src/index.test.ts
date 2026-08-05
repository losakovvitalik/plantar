import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeployLogWriter,
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
  removeProjectHistory,
  removeProjectLogs,
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

describe("DeployLogWriter", () => {
  it("пишет строки после создания, close() сбрасывает и освобождает дескриптор", () => {
    const writer = new DeployLogWriter("app");
    // closed mirrors the descriptor state, so re-entered callers can check it
    expect(writer.closed).toBe(false);
    writer.write("первая строка");
    writer.write("вторая строка");
    writer.close();
    expect(writer.closed).toBe(true);
    // The content is fully on disk after close()
    expect(readFileSync(writer.file, "utf8")).toBe("первая строка\nвторая строка\n");
    // The descriptor is released: a write after close fails loudly instead
    // of hitting a recycled descriptor of some unrelated file
    expect(() => writer.write("после закрытия")).toThrow();
    expect(readFileSync(writer.file, "utf8")).toBe("первая строка\nвторая строка\n");
    // close() is safe to call twice
    expect(() => writer.close()).not.toThrow();
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

// POSIX-only: Windows does not map these permission bits
describe.skipIf(process.platform === "win32")("права доступа settings.json", () => {
  const settingsFile = () => path.join(dataDir(), "settings.json");
  const fileMode = () => statSync(settingsFile()).mode & 0o777;

  /** Settings written by an install from before the 0600 policy: world-readable.
   *  chmod rather than a writeFileSync mode — the test umask must not interfere */
  function seedLooseSettings(content = "{}"): void {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(settingsFile(), content);
    chmodSync(settingsFile(), 0o644);
  }

  it("writeSettings создаёт файл, читаемый только владельцем", () => {
    writeSettings({ ...readSettings(), letsEncryptEmail: "a@b.c" });
    // The rename carries the temp file's permissions onto the target, so this
    // also proves the temp file never sat on disk world-readable
    expect(fileMode()).toBe(0o600);
  });

  it("файл прежней установки ужесточается уже при чтении настроек", () => {
    seedLooseSettings(JSON.stringify({ letsEncryptEmail: "a@b.c" }));

    const settings = readSettings();

    expect(fileMode()).toBe(0o600);
    expect(settings.letsEncryptEmail).toBe("a@b.c");
  });

  it("перезапись файла прежней установки не оставляет широких прав", () => {
    // Defaults are taken before the loose file exists: the write path must
    // tighten on its own, without the read-side healing
    const settings = readSettings();
    seedLooseSettings();

    writeSettings(settings);

    expect(fileMode()).toBe(0o600);
  });

  it("залежавшийся tmp-файл прежней установки не ослабляет права", () => {
    // A stale temp file left by a hard-killed pre-0600 write and reused after
    // PID wraparound: open()'s mode applies only at creation, so without the
    // explicit fchmod the rename would carry 0644 onto settings.json
    mkdirSync(dataDir(), { recursive: true });
    const tmp = `${settingsFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, "{");
    chmodSync(tmp, 0o644);

    writeSettings(readSettings());

    expect(fileMode()).toBe(0o600);
  });

  it("recovery-копия .broken прежней установки ужесточается при чтении", () => {
    // A .broken copy made before the 0600 policy holds the same token as the
    // settings.json of the time and kept its loose permissions
    mkdirSync(dataDir(), { recursive: true });
    const backup = `${settingsFile()}.broken`;
    writeFileSync(backup, "{");
    chmodSync(backup, 0o644);

    readSettings();

    expect(statSync(backup).mode & 0o777).toBe(0o600);
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

  /** Puts a run file on disk (history is seeded separately); mtime = run time */
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

  it("файл вытесненной записи другого проекта тоже удаляется", () => {
    const evicted = writeLog("site-b", "2026-07-01T10:00:00.000Z");
    const survivor = writeLog("site-b", "2026-07-02T10:00:00.000Z");
    seedHistory([
      run("site-b", "2026-07-01T10:00:00.000Z"),
      ...Array.from({ length: 200 }, (_, i) =>
        run("site-b", `2026-07-02T10:00:00.${String(i).padStart(3, "0")}Z`),
      ),
    ]);

    // Лимит срабатывает при деплое другого проекта: файл вытесненной записи
    // site-b соберётся только при обходе всех задетых лимитом проектов
    appendHistory(run("site-a", "2026-07-12T10:00:00.000Z"));

    expect(existsSync(evicted)).toBe(false);
    expect(existsSync(survivor)).toBe(true);
  });

  it("свежий файл без записи остаётся: это прерванный прогон", () => {
    seedHistory([]);
    const interrupted = writeLog("site-a", "2026-07-12T11:00:00.000Z");

    appendHistory(run("site-a", "2026-07-12T10:00:00.000Z"));

    expect(existsSync(interrupted)).toBe(true);
  });

  it("запись без startedAt не отключает защиту прерванного прогона", () => {
    const { startedAt: _dropped, ...withoutStartedAt } = run(
      "site-a",
      "2026-07-01T10:00:00.000Z",
    );
    seedHistory([
      withoutStartedAt as DeployRecord,
      run("site-a", "2026-07-02T10:00:00.000Z"),
    ]);
    const undated = writeLog("site-a", "2026-07-01T10:00:00.000Z");
    const interrupted = writeLog("site-a", "2026-07-12T11:00:00.000Z");

    appendHistory(run("site-a", "2026-07-12T10:00:00.000Z"));

    // Запись без startedAt стоит первой: если её не отсеять, «новее самой
    // свежей записи» перестаёт срабатывать сразу для всей папки
    expect(existsSync(interrupted)).toBe(true);
    // При этом сама запись осталась в истории и видна в интерфейсе — её файл
    // отсеиванием трогать нельзя
    expect(existsSync(undated)).toBe(true);
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
    // A second run of the same name (another server or the CLI) started earlier and is still going
    const live = writeLog("site", "2026-07-12T09:00:00.000Z");
    utimesSync(live, new Date(), new Date());

    appendHistory(run("site", "2026-07-12T10:00:00.000Z"));

    expect(readFileSync(live, "utf8")).toBe("log");
  });

  it("прогон, начатый меньше суток назад, остаётся, даже если давно не писал", () => {
    seedHistory([]);
    // A long remote build can go hours without writing a single line
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

  it("файл, на который ссылается .broken-копия, переживает и последующие деплои", () => {
    const referenced = writeLog("site", "2026-07-01T10:00:00.000Z");
    // Realistic corruption: the old history text survives truncated, so the
    // recovery copy still references the file by name
    corruptStore(
      "history.json",
      JSON.stringify([run("site", "2026-07-01T10:00:00.000Z")]).slice(0, -2),
    );

    appendHistory(run("site", "2026-07-12T10:00:00.000Z"));
    appendHistory(run("site", "2026-07-12T11:00:00.000Z"));
    appendHistory(run("site", "2026-07-12T12:00:00.000Z"));

    expect(existsSync(referenced)).toBe(true);
  });

  it("история верного JSON, но не той формы, тоже сохраняется копией", () => {
    const referenced = writeLog("site", "2026-07-01T10:00:00.000Z");
    // Валидный JSON не той формы разбирается без ошибки, поэтому копию для
    // ручного восстановления сохраняет само чтение истории
    corruptStore(
      "history.json",
      JSON.stringify({ records: [run("site", "2026-07-01T10:00:00.000Z")] }),
    );

    appendHistory(run("site", "2026-07-12T10:00:00.000Z"));
    appendHistory(run("site", "2026-07-12T11:00:00.000Z"));

    expect(existsSync(path.join(dataDir(), "history.json.broken"))).toBe(true);
    expect(existsSync(referenced)).toBe(true);
  });

  it("файл без записи и без упоминания в .broken-копии — мусор, он собирается", () => {
    const orphan = writeLog("site", "2026-07-01T10:00:00.000Z");
    corruptStore("history.json"); // '{"broken":' — the copy references no files

    appendHistory(run("site", "2026-07-12T10:00:00.000Z"));
    appendHistory(run("site", "2026-07-12T11:00:00.000Z"));

    // Nothing is recoverable from a copy that names no logs, so the orphan is
    // unreachable garbage — exactly what the cleanup exists to collect
    expect(existsSync(orphan)).toBe(false);
  });

  it("запись без logFile не роняет appendHistory и не прерывает очистку", () => {
    const orphan = writeLog("site", "2026-07-01T10:00:00.000Z");
    const valid = writeLog("site", "2026-07-05T10:00:00.000Z");
    const { logFile: _dropped, ...withoutLogFile } = run("site", "2026-07-03T10:00:00.000Z");
    seedHistory([withoutLogFile as DeployRecord, run("site", "2026-07-05T10:00:00.000Z")]);

    expect(() => appendHistory(run("site", "2026-07-12T10:00:00.000Z"))).not.toThrow();

    // The malformed records are skipped, not fatal: the pass still ran to the
    // end (the orphan is gone) and the healthy record's file is untouched
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(valid)).toBe(true);
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

  it("после переименования чистится и папка старого имени", () => {
    writeServers([server("srv-1")]);
    writeProjects([project({ previousNames: ["site-old"] })]);
    const evicted = writeLog("site-old", "2026-07-01T10:00:00.000Z");
    const survivor = writeLog("site-old", "2026-07-02T10:00:00.000Z");
    seedHistory([
      run("site-old", "2026-07-01T10:00:00.000Z"),
      ...Array.from({ length: 199 }, (_, i) =>
        run("site-old", `2026-07-02T10:00:00.${String(i).padStart(3, "0")}Z`),
      ),
    ]);

    // Прогоны до переименования лежат в папке старого имени, а вытесняет их
    // запись под новым: без обхода всех имён проекта эти файлы никто не соберёт
    appendHistory({ ...run("site-new", "2026-07-09T10:00:00.000Z"), projectId: "prj-1" });

    expect(existsSync(evicted)).toBe(false);
    expect(existsSync(survivor)).toBe(true);
  });

  it("папка, все записи которой вытеснены разом, тоже чистится", () => {
    writeServers([server("srv-1")]);
    writeProjects([project({ previousNames: ["site-old"] })]);
    const evicted = writeLog("site-old", "2026-07-01T10:00:00.000Z");
    // A run started in the last 24 h in the same directory (the CLI deploying
    // under the old name, say) must survive the fallback cutoff
    const recent = writeLog(
      "site-old",
      new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    );
    // Enough new-name records that the single old-name one falls out of the
    // shared per-project group in this very call — from then on the old
    // directory has no record of its own, in this pass or in any later one
    seedHistory([
      run("site-old", "2026-07-01T10:00:00.000Z"),
      ...Array.from({ length: 200 }, (_, i) =>
        run("site-new", `2026-07-02T10:00:00.${String(i).padStart(3, "0")}Z`),
      ),
    ]);

    appendHistory({ ...run("site-new", new Date().toISOString()), projectId: "prj-1" });

    expect(readHistory().filter((r) => r.project === "site-old")).toHaveLength(0);
    expect(existsSync(evicted)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });
});
