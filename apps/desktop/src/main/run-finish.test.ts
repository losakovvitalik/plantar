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

/** Test double of the orchestrator surroundings: records every run.finish
 *  result and every notification, so the tests can assert what closed the run */
function harness(over: Partial<RunFinishContext> = {}) {
  const finishes: Array<Record<string, unknown>> = [];
  const notified: boolean[] = [];
  const ctx: RunFinishContext = {
    run: {
      log: () => {},
      finish: (result) => {
        finishes.push(result);
      },
    },
    project: "app",
    projectId: "p1",
    host: "203.0.113.1",
    startedAt: "2026-08-04T10:00:00.000Z",
    kind: "rollback",
    notify: (success) => {
      notified.push(success);
    },
    ...over,
  };
  const finish = (outcome: RunOutcome) => finishRun(ctx, outcome);
  return { finish, finishes, notified };
}

describe("finishRun", () => {
  it("failed rollback: history record carries the error code, notification always fires", () => {
    const logWriter = new DeployLogWriter("app");
    const { finish, finishes, notified } = harness({ logWriter });
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
  });

  it("closes the run before the disk writes: a failing log write cannot leave it open", () => {
    const logWriter = new DeployLogWriter("app");
    vi.spyOn(logWriter, "write").mockImplementation(() => {
      throw new Error("disk full");
    });
    const { finish, finishes, notified } = harness({ logWriter });

    // The helper does not swallow the disk failure...
    expect(() => finish({ status: "error", err: new Error("rollback failed") })).toThrow(
      "disk full",
    );

    // ...but by then the run snapshot was already closed and the user
    // notified, so the project is not locked in a running deploy
    expect(finishes).toEqual([
      { status: "error", error: "rollback failed", code: undefined },
    ]);
    expect(notified).toEqual([false]);
    // The history record never made it to disk: run.finish really ran first
    expect(readHistory()).toEqual([]);
  });

  it("successful rollback: urlCheck reaches both the history record and the run snapshot", () => {
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

  it("success notification obeys the setting, error notification fires even when it is off", () => {
    writeSettings({ ...readSettings(), notifyOnDeploySuccess: false });
    const logWriter = new DeployLogWriter("app");
    const { finish, notified } = harness({ logWriter });

    finish({ status: "success", url: "https://site.example/", urlCheck: "answered" });
    expect(notified).toEqual([]);

    finish({ status: "error", err: new Error("boom") });
    expect(notified).toEqual([false]);
  });

  it("thrown deploy: error history record plus run.finish with status error", () => {
    const logWriter = new DeployLogWriter("app");
    // A plain managed deploy passes no kind and keeps the attempted commit
    const { finish, finishes, notified } = harness({ logWriter, kind: undefined });

    finish({ status: "error", err: new Error("deploy failed"), commit: "abc1234" });

    const records = readHistory();
    expect(records).toMatchObject([
      {
        project: "app",
        projectId: "p1",
        host: "203.0.113.1",
        status: "error",
        error: "deploy failed",
        commit: "abc1234",
        logFile: logWriter.file,
      },
    ]);
    // History reads the absent kind field as an ordinary deploy
    expect(records[0].kind).toBeUndefined();
    expect(finishes).toEqual([{ status: "error", error: "deploy failed", code: undefined }]);
    expect(notified).toEqual([false]);
  });

  it("failure before the log file exists: no history record, but the run closes and notifies", () => {
    const { finish, finishes, notified } = harness({ logWriter: undefined });

    finish({ status: "error", err: new Error("disk full") });

    expect(readHistory()).toEqual([]);
    expect(finishes).toEqual([{ status: "error", error: "disk full", code: undefined }]);
    expect(notified).toEqual([false]);
  });
});
