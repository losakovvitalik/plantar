import { describe, expect, it } from "vitest";
import type { DeployRecord } from "./index";
import { deployLogTimestamp, resolveLastRun } from "./last-run";

function record(overrides: Partial<DeployRecord>): DeployRecord {
  return {
    project: "site",
    host: "1.2.3.4",
    startedAt: "2026-07-12T10:00:00.000Z",
    finishedAt: "2026-07-12T10:01:00.000Z",
    status: "success",
    logFile: "/data/logs/site/deploy-2026-07-12T10-00-00-000Z.log",
    ...overrides,
  };
}

describe("deployLogTimestamp", () => {
  it("восстанавливает ISO-метку из имени файла", () => {
    expect(
      deployLogTimestamp("/data/logs/site/deploy-2026-07-12T10-00-00-000Z.log"),
    ).toBe("2026-07-12T10:00:00.000Z");
  });

  it("возвращает null для имени не по конвенции", () => {
    expect(deployLogTimestamp("nginx-access.log")).toBeNull();
    expect(deployLogTimestamp("deploy-broken.log")).toBeNull();
  });
});

describe("resolveLastRun", () => {
  it("нет ни файлов, ни истории — прогона нет", () => {
    expect(resolveLastRun([], [])).toBeNull();
  });

  it("свежайший файл упомянут в истории — прогон завершён, результат из записи", () => {
    const rec = record({});
    const result = resolveLastRun([rec.logFile], [rec]);
    expect(result).toEqual({ logFile: rec.logFile, record: rec });
  });

  it("файл без записи и новее последней записи — деплой был прерван", () => {
    const rec = record({});
    const orphan = "/data/logs/site/deploy-2026-07-12T11-00-00-000Z.log";
    expect(resolveLastRun([rec.logFile, orphan], [rec])).toEqual({
      logFile: orphan,
    });
  });

  it("файл без записи, истории нет — деплой был прерван", () => {
    const orphan = "/data/logs/site/deploy-2026-07-12T11-00-00-000Z.log";
    expect(resolveLastRun([orphan], [])).toEqual({ logFile: orphan });
  });

  it("осиротевший файл старее последней записи — берётся запись истории", () => {
    const orphan = "/data/logs/site/deploy-2026-07-12T09-00-00-000Z.log";
    const rec = record({});
    expect(resolveLastRun([orphan, rec.logFile], [rec])).toEqual({
      logFile: rec.logFile,
      record: rec,
    });
  });

  it("файлов нет, но история есть — берётся последняя запись", () => {
    const rec = record({});
    expect(resolveLastRun([], [rec])).toEqual({
      logFile: rec.logFile,
      record: rec,
    });
  });

  it("последняя запись важнее свежайшего файла, если её лог удалён", () => {
    const older = record({});
    const newer = record({
      startedAt: "2026-07-12T12:00:00.000Z",
      finishedAt: "2026-07-12T12:01:00.000Z",
      status: "error",
      error: "boom",
      logFile: "/data/logs/site/deploy-2026-07-12T12-00-00-000Z.log",
    });
    // На диске остался только старый файл — последним всё равно считается newer
    expect(resolveLastRun([older.logFile], [older, newer])).toEqual({
      logFile: newer.logFile,
      record: newer,
    });
  });

  it("файл с нечитаемой меткой времени не считается прерванным прогоном", () => {
    const rec = record({});
    expect(resolveLastRun(["/data/logs/site/deploy-manual.log", rec.logFile], [rec])).toEqual(
      { logFile: rec.logFile, record: rec },
    );
  });
});
