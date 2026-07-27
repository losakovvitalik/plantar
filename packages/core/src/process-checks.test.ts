import { describe, expect, it } from "vitest";
import type { SshConnection } from "@plantar/ssh";

import {
  AppNotRespondingError,
  ProcessUnstableError,
  waitForApp,
  waitForStableProcess,
} from "./process-checks";

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** SSH-заглушка: результат команды задаёт первое подошедшее правило, остальные команды успешны */
function fakeConn(
  rules: Array<[RegExp, Partial<ExecResult>]>,
  commands: string[],
): SshConnection {
  return {
    host: "203.0.113.1",
    exec: (command: string) => {
      commands.push(command);
      const rule = rules.find(([re]) => re.test(command));
      return Promise.resolve({ code: 0, stdout: "", stderr: "", ...rule?.[1] });
    },
  } as unknown as SshConnection;
}

// pm2 allows apostrophes in process names, and imported apps bring their own
const TRICKY_NAME = "it's-api";
const QUOTED_NAME = "'it'\\''s-api'";

describe("waitForApp", () => {
  it("имя процесса в pm2 logs экранируется", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/curl/, { code: 1 }]], commands);

    await expect(waitForApp(conn, TRICKY_NAME, 3000, () => {})).rejects.toBeInstanceOf(
      AppNotRespondingError,
    );

    const logsCommand = commands.find((c) => c.startsWith("pm2 logs"));
    expect(logsCommand).toBe(`pm2 logs ${QUOTED_NAME} --nostream --lines 30 2>&1`);
  });
});

describe("waitForStableProcess", () => {
  it("имя процесса в pm2 logs экранируется", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/pm2 jlist/, { stdout: "NOW:100000\n[]" }]], commands);

    await expect(waitForStableProcess(conn, TRICKY_NAME, () => {})).rejects.toBeInstanceOf(
      ProcessUnstableError,
    );

    const logsCommand = commands.find((c) => c.startsWith("pm2 logs"));
    expect(logsCommand).toBe(`pm2 logs ${QUOTED_NAME} --nostream --lines 30 2>&1`);
  });
});
