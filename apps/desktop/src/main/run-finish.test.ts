import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeployLogWriter,
  readHistory,
  readSettings,
  writeSettings,
} from "@plantar/storage";
import { type RunFinishContext, type RunOutcome, finishRun } from "./run-finish";

let tmpHome: string;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-run-finish-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

/** Test double of the orchestrator surroundings: records every run.finish and
 *  notify call into a shared sequence, so ordering can be asserted too */
function harness(over: Partial<RunFinishContext> = {}) {
  const calls: string[] = [];
  const finishes: Array<Record<string, unknown>> = [];
  const notified: boolean[] = [];
  const ctx: RunFinishContext = {
    run: {
      log: () => {},
      finish: (result) => {
        calls.push("run.finish");
        finishes.push(result);
      },
    },
    project: "app",
    projectId: "p1",
    host: "203.0.113.1",
    startedAt: "2026-08-04T10:00:00.000Z",
    kind: "rollback",
    notify: (success) => {
      calls.push("notify");
      notified.push(success);
    },
    ...over,
  };
  const finish = (outcome: RunOutcome) => finishRun(ctx, outcome);
  return { finish, calls, finishes, notified };
}

describe("finishRun", () => {
  it("упавший возврат версии: запись истории с кодом ошибки, уведомление уходит всегда", () => {
    const logWriter = new DeployLogWriter("app");
    const { finish, calls, finishes, notified } = harness({ logWriter });
    const err = Object.assign(new Error("rollback failed"), {
      code: "npm-peer-conflict",
    });

    finish({ status: "error", err });

    expect(readHistory()).toMatchObject([
      {
        project: "app",
        projectId: "p1",
        host: "203.0.113.1",
        status: "error",
        kind: "rollback",
        error: "rollback failed",
        code: "npm-peer-conflict",
        logFile: logWriter.file,
      },
    ]);
    expect(finishes).toEqual([
      { status: "error", error: "rollback failed", code: "npm-peer-conflict" },
    ]);
    expect(notified).toEqual([false]);
    // Run status updates first: a disk-write failure must not leave the
    // project locked in a running deploy
    expect(calls[0]).toBe("run.finish");
  });

  it("успешный возврат: urlCheck попадает и в запись истории, и в снимок прогона", () => {
    const logWriter = new DeployLogWriter("app");
    const { finish, finishes, notified } = harness({ logWriter });

    finish({ status: "success", url: "https://site.example/", urlCheck: "answered" });

    expect(readHistory()).toMatchObject([
      {
        status: "success",
        kind: "rollback",
        url: "https://site.example/",
        urlCheck: "answered",
        logFile: logWriter.file,
      },
    ]);
    expect(finishes).toEqual([
      { status: "success", url: "https://site.example/", urlCheck: "answered" },
    ]);
    // notifyOnDeploySuccess is on by default
    expect(notified).toEqual([true]);
  });

  it("уведомление об успехе подчиняется настройке, об ошибке — уходит и при выключенной", () => {
    writeSettings({ ...readSettings(), notifyOnDeploySuccess: false });
    const logWriter = new DeployLogWriter("app");
    const { finish, notified } = harness({ logWriter });

    finish({ status: "success", url: "https://site.example/", urlCheck: "answered" });
    expect(notified).toEqual([]);

    finish({ status: "error", err: new Error("boom") });
    expect(notified).toEqual([false]);
  });

  it("ошибка до создания файла лога: записи истории нет, но прогон закрыт и уведомление ушло", () => {
    const { finish, finishes, notified } = harness({ logWriter: undefined });

    finish({ status: "error", err: new Error("disk full") });

    expect(readHistory()).toEqual([]);
    expect(finishes).toEqual([{ status: "error", error: "disk full", code: undefined }]);
    expect(notified).toEqual([false]);
  });
});
