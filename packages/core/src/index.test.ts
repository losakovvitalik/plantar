import { describe, expect, it } from "vitest";
import type { SshConnection } from "@plantar/ssh";
import type { ProjectConfig } from "@plantar/config";

import { certbotAccountArgs, deployProject, pickRollbackTarget, rollbackProject } from "./index";
import { t } from "./messages";

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
    uploadDirectory: () => Promise.resolve(1),
  } as unknown as SshConnection;
}

const appConfig = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  name: "app",
  type: "node",
  runtime: "node",
  packageManager: "npm",
  buildCommand: "npm run build",
  buildDir: "dist",
  startCommand: "node server.js",
  port: 3005,
  ...over,
});

const jlist = (cwd: string) =>
  JSON.stringify([{ name: "app", pid: 11, pm2_env: { status: "online", pm_cwd: cwd } }]);

const PREV_ECOSYSTEM = /pm2 start '\/var\/www\/app\/releases\/2025-06-01\/plantar\.pm2\.config\.cjs'/;

describe("deployProject: восстановление после неудачного деплоя", () => {
  it("новая версия не отвечает — возвращается прежняя, ошибка пробрасывается, current не переключается", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-01\n" }],
        // Новая версия не отвечает по своему порту; прежняя (3004) отвечает
        [/curl .*127\.0\.0\.1:3005\//, { code: 1 }],
        [
          /cat '\/var\/www\/app\/releases\/2025-06-01\/plantar\.pm2\.config\.cjs'/,
          { stdout: '"PORT": 3004' },
        ],
      ],
      commands,
    );

    await expect(
      deployProject(conn, "/nonexistent", appConfig(), (line) => logs.push(line)),
    ).rejects.toThrow(/3005/);

    expect(logs).toContain(t("restoringPrevious", { release: "2025-06-01" }));
    expect(logs).toContain(t("previousRestored", { release: "2025-06-01" }));
    expect(commands.some((c) => PREV_ECOSYSTEM.test(c))).toBe(true);
    // Симлинк current остаётся на рабочей версии
    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
  });

  it("восстановление не удалось — в лог попадает причина, наружу уходит исходная ошибка", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-01\n" }],
        [/curl .*127\.0\.0\.1:3005\//, { code: 1 }],
        [PREV_ECOSYSTEM, { code: 1, stderr: "restore-boom" }],
      ],
      commands,
    );

    await expect(
      deployProject(conn, "/nonexistent", appConfig(), (line) => logs.push(line)),
    ).rejects.toThrow(/3005/);

    expect(logs).toContain(t("restoringPrevious", { release: "2025-06-01" }));
    expect(logs.some((line) => line.includes("restore-boom"))).toBe(true);
  });

  it("первый деплой без сохранённых версий — восстанавливать нечего, чужие процессы не трогаются", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "" }],
        [/readlink '\/var\/www\/app\/current'/, { code: 1 }],
        [/curl .*127\.0\.0\.1:3005\//, { code: 1 }],
      ],
      commands,
    );

    await expect(deployProject(conn, "/nonexistent", appConfig(), () => {})).rejects.toThrow(
      /3005/,
    );

    // Единственный pm2 start — запуск новой версии; попыток восстановления не было
    expect(commands.filter((c) => c.includes("pm2 start '")).length).toBe(1);
  });
});

describe("rollbackProject", () => {
  it("после неудачного деплоя с двумя версиями возвращает рабочую, а не бросает ошибку", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-02\n2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-01\n" }],
        // pm2-процесс запущен из сломанной версии, current указывает на рабочую
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-02") }],
        [
          /cat '\/var\/www\/app\/releases\/2025-06-01\/plantar\.pm2\.config\.cjs'/,
          { stdout: '"PORT": 3005' },
        ],
      ],
      commands,
    );

    const result = await rollbackProject(conn, appConfig(), (line) => logs.push(line));

    expect(result.release).toBe("2025-06-01");
    expect(logs).toContain(t("rollbackToWorking", { release: "2025-06-01" }));
    expect(commands.some((c) => PREV_ECOSYSTEM.test(c))).toBe(true);
    expect(commands).toContain("ln -sfn 'releases/2025-06-01' '/var/www/app/current'");
  });

  it("pm2 разошёлся с current при трёх версиях — возвращает current, не перепрыгивая на более старую", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-03\n2025-06-02\n2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-02\n" }],
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-03") }],
        [
          /cat '\/var\/www\/app\/releases\/2025-06-02\/plantar\.pm2\.config\.cjs'/,
          { stdout: '"PORT": 3005' },
        ],
      ],
      commands,
    );

    const result = await rollbackProject(conn, appConfig(), () => {});

    expect(result.release).toBe("2025-06-02");
  });

  it("процесс совпадает с current — обычный возврат на предыдущую версию", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-02\n2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-02\n" }],
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-02") }],
        [
          /cat '\/var\/www\/app\/releases\/2025-06-01\/plantar\.pm2\.config\.cjs'/,
          { stdout: '"PORT": 3005' },
        ],
      ],
      commands,
    );

    const result = await rollbackProject(conn, appConfig(), (line) => logs.push(line));

    expect(result.release).toBe("2025-06-01");
    expect(logs).toContain(t("rollbackStarting", { release: "2025-06-01" }));
  });

  it("единственная версия и процесс из неё же — возвращаться некуда", async () => {
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-01\n" }],
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-01") }],
      ],
      [],
    );

    await expect(rollbackProject(conn, appConfig(), () => {})).rejects.toThrow(
      t("rollbackNoPrevious"),
    );
  });
});

describe("pickRollbackTarget", () => {
  it("процесс совпадает с current — предыдущая версия", () => {
    expect(pickRollbackTarget(["3", "2", "1"], "3", "3")).toBe("2");
  });

  it("процесс разошёлся с current — сам current (последняя рабочая версия)", () => {
    expect(pickRollbackTarget(["3", "2", "1"], "2", "3")).toBe("2");
    expect(pickRollbackTarget(["2", "1"], "1", "2")).toBe("1");
  });

  it("процесс не найден — тоже возврат на current", () => {
    expect(pickRollbackTarget(["2", "1"], "2", null)).toBe("2");
  });

  it("возвращаться некуда — null", () => {
    expect(pickRollbackTarget(["1"], "1", "1")).toBe(null);
  });
});

describe("certbotAccountArgs", () => {
  it("обычный email оборачивается в кавычки", () => {
    expect(certbotAccountArgs("user@mail.com")).toBe("--email 'user@mail.com' --no-eff-email");
  });

  it("апостроф в email экранируется, а не ломает команду", () => {
    expect(certbotAccountArgs("o'brien@mail.com")).toBe(
      "--email 'o'\\''brien@mail.com' --no-eff-email",
    );
  });

  it("без email — регистрация без почты", () => {
    expect(certbotAccountArgs(undefined)).toBe("--register-unsafely-without-email");
  });
});
