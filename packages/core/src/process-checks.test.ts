import { describe, expect, it } from "vitest";
import type { SshConnection } from "@plantar/ssh";

import {
  AppNotRespondingError,
  ProcessUnstableError,
  verifySiteAvailable,
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

describe("verifySiteAvailable", () => {
  const HTTPS = "https://site.example/";
  const HTTP = "http://site.example/";
  /** The live messages are the only ones marked with a tick */
  const confirmed = (lines: string[]) => lines.some((line) => line.startsWith("✓"));

  it("адрес ответил — проверка пройдена", async () => {
    const conn = fakeConn([[/curl/, { code: 0, stdout: "200\n" }]], []);

    await expect(
      verifySiteAvailable(conn, HTTPS, "appAvailable", () => {}),
    ).resolves.toBe("answered");
  });

  it("адрес не ответил — результат уходит вызывающему, а не только в лог", async () => {
    const lines: string[] = [];
    const conn = fakeConn([[/curl/, { code: 1, stdout: "000\n" }]], []);

    await expect(
      verifySiteAvailable(conn, HTTPS, "appAvailable", (line) => lines.push(line)),
    ).resolves.toBe("no-answer");
    expect(lines.join("\n")).toContain(HTTPS);
  });

  it("ответил только обычный http: это отдельный исход, а не подтверждение", async () => {
    const commands: string[] = [];
    const lines: string[] = [];
    const conn = fakeConn(
      [
        [/'https:\/\//, { code: 1, stdout: "000\n" }],
        [/'http:\/\//, { code: 0, stdout: "200\n" }],
      ],
      commands,
    );

    await expect(
      verifySiteAvailable(conn, HTTPS, "appAvailable", (line) => lines.push(line), {
        httpFallback: true,
      }),
    ).resolves.toBe("plain-http");
    expect(commands).toHaveLength(2);
    expect(lines.join("\n")).toContain(HTTP);
    expect(confirmed(lines)).toBe(false);
    // The https loop has already waited out its retries, so the fallback probe
    // is short: it only tells the schemes apart, and the user waits for it
    expect(commands[0]).toContain("seq 1 5");
    expect(commands[1]).toContain("seq 1 2");
  });

  it("редирект дефолтного сервера nginx: домен просто указывает на сервер — не подтверждение", async () => {
    const lines: string[] = [];
    const conn = fakeConn(
      [
        [/'https:\/\//, { code: 1, stdout: "000\n" }],
        // return 301 https://… of an untouched nginx: any host resolving to
        // the server gets it, so an answer here says nothing about the app
        [/'http:\/\//, { code: 0, stdout: "301\n" }],
      ],
      [],
    );

    await expect(
      verifySiteAvailable(conn, HTTPS, "appAvailable", (line) => lines.push(line), {
        httpFallback: true,
      }),
    ).resolves.toBe("plain-http");
    expect(confirmed(lines)).toBe(false);
  });

  it("не ответил ни один адрес: исход — «не ответило»", async () => {
    const conn = fakeConn([[/curl/, { code: 1, stdout: "000\n" }]], []);

    await expect(
      verifySiteAvailable(conn, HTTPS, "appAvailable", () => {}, { httpFallback: true }),
    ).resolves.toBe("no-answer");
  });

  it("ответ 502 — до приложения не достучались, http-запасной проверки нет", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/curl/, { code: 1, stdout: "502\n" }]], commands);

    await expect(
      verifySiteAvailable(conn, HTTPS, "appAvailable", () => {}, { httpFallback: true }),
    ).resolves.toBe("no-answer");
    expect(commands).toHaveLength(1);
  });

  it("управляемый деплой: nginx и сертификат настроил Plantar — http не спрашиваем", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/curl/, { code: 1, stdout: "000\n" }]], commands);

    await expect(
      verifySiteAvailable(conn, HTTPS, "siteAvailable", () => {}),
    ).resolves.toBe("no-answer");
    expect(commands).toHaveLength(1);
  });
});
