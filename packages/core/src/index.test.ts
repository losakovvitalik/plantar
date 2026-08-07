import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SshConnection } from "@plantar/ssh";
import type { ProjectConfig } from "@plantar/config";

import {
  certbotAccountArgs,
  deployProject,
  getServerInfo,
  logStreamCommand,
  parseServerInfoOutput,
  pickFreePort,
  pickRollbackTarget,
  removeDeployedProject,
  rollbackProject,
  serverInfoCommand,
} from "./index";
import { t } from "./messages";

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** SSH-заглушка: результат команды задаёт первое подошедшее правило, остальные команды успешны.
 *  A rule mapping to an Error rejects the exec call — a dropped SSH connection. */
function fakeConn(
  rules: Array<[RegExp, Partial<ExecResult> | Error]>,
  commands: string[],
  uploadDirectory: () => Promise<number> = () => Promise.resolve(1),
): SshConnection {
  return {
    host: "203.0.113.1",
    exec: (command: string) => {
      commands.push(command);
      const rule = rules.find(([re]) => re.test(command));
      if (rule?.[1] instanceof Error) return Promise.reject(rule[1]);
      return Promise.resolve({ code: 0, stdout: "", stderr: "", ...rule?.[1] });
    },
    uploadDirectory,
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

// A dropped SSH connection surfaces as a rejected exec call; each test drops it
// at one deploy phase and checks the error escapes without a recorded success
// (current is never switched, the final success message never appears)
describe("deployProject: обрыв SSH-соединения посреди деплоя", () => {
  const drop = () => new Error("Connection lost");

  it("node: обрыв на загрузке файлов — ошибка наружу, установка и переключение версии не начинались", async () => {
    const commands: string[] = [];
    const conn = fakeConn([], commands, () => Promise.reject(drop()));

    await expect(deployProject(conn, "/nonexistent", appConfig(), () => {})).rejects.toThrow(
      "Connection lost",
    );

    expect(commands.some((c) => c.includes("npm install"))).toBe(false);
    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
  });

  it("node: обрыв на установке зависимостей — ошибка наружу, pm2 не запускался", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/npm install/, drop()]], commands);

    await expect(deployProject(conn, "/nonexistent", appConfig(), () => {})).rejects.toThrow(
      "Connection lost",
    );

    expect(commands.some((c) => c.includes("pm2 start"))).toBe(false);
    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
  });

  it("node: обрыв на запуске pm2 — ошибка наружу, current не переключается", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "" }],
        [/readlink '\/var\/www\/app\/current'/, { code: 1 }],
        [/pm2 start/, drop()],
      ],
      commands,
    );

    await expect(deployProject(conn, "/nonexistent", appConfig(), () => {})).rejects.toThrow(
      "Connection lost",
    );

    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
  });

  it("bot: обрыв на запуске pm2 — ошибка наружу, деплой не объявляется успешным", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "" }],
        [/readlink '\/var\/www\/app\/current'/, { code: 1 }],
        [/pm2 start/, drop()],
      ],
      commands,
    );

    await expect(
      deployProject(conn, "/nonexistent", appConfig({ type: "bot" }), (line) => logs.push(line)),
    ).rejects.toThrow("Connection lost");

    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
    expect(logs).not.toContain(t("botDeployed"));
  });

  it("bot: обрыв на проверке стабильности процесса — ошибка наружу, current не переключается", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "" }],
        [/readlink '\/var\/www\/app\/current'/, { code: 1 }],
        [/pm2 jlist/, drop()],
      ],
      commands,
    );

    await expect(
      deployProject(conn, "/nonexistent", appConfig({ type: "bot" }), (line) => logs.push(line)),
    ).rejects.toThrow("Connection lost");

    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
    expect(logs).not.toContain(t("botDeployed"));
  });

  it("rollback: обрыв на чтении списка версий — ошибка наружу, возврат не объявляется успешным", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [[/ls -1 '\/var\/www\/app\/releases'/, drop()]],
      commands,
    );

    await expect(
      rollbackProject(conn, appConfig(), (line) => logs.push(line)),
    ).rejects.toThrow("Connection lost");

    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
    expect(logs.some((line) => line === t("rollbackDone", { release: "2025-06-01" }))).toBe(false);
  });

  it("rollback: обрыв на перезапуске прежней версии — ошибка наружу, current не переключается", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-02\n2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-02\n" }],
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-02") }],
        [PREV_ECOSYSTEM, drop()],
      ],
      commands,
    );

    await expect(
      rollbackProject(conn, appConfig(), (line) => logs.push(line)),
    ).rejects.toThrow("Connection lost");

    expect(commands.some((c) => c.startsWith("ln -sfn"))).toBe(false);
    expect(logs).not.toContain(t("rollbackDone", { release: "2025-06-01" }));
  });
});

describe("pickFreePort", () => {
  const ssLine = (port: number) => `LISTEN 0 511 0.0.0.0:${port} 0.0.0.0:*`;

  it("возвращает первый порт диапазона, не занятый процессом и не закреплённый в nginx", async () => {
    const conn = fakeConn(
      [
        [/^ss -tlnH$/, { stdout: [ssLine(80), ssLine(3001), ssLine(3003)].join("\n") }],
        [/^grep -rhoE/, { stdout: "proxy_pass http://127.0.0.1:3002\n" }],
      ],
      [],
    );

    await expect(pickFreePort(conn)).resolves.toBe(3004);
  });

  it("все порты диапазона заняты — понятная ошибка вместо повторной выдачи занятого порта", async () => {
    const lines: string[] = [];
    for (let port = 3001; port <= 3999; port++) lines.push(ssLine(port));
    const conn = fakeConn([[/^ss -tlnH$/, { stdout: lines.join("\n") }]], []);

    await expect(pickFreePort(conn)).rejects.toThrow(
      t("noFreePort", { from: 3001, to: 3999 }),
    );
  });

  it("непарсимый вывод команд не роняет подбор — берётся первый порт диапазона", async () => {
    const conn = fakeConn(
      [
        [/^ss -tlnH$/, { stdout: "bash: ss: command not found" }],
        [/^grep -rhoE/, { code: 1, stdout: "" }],
      ],
      [],
    );

    await expect(pickFreePort(conn)).resolves.toBe(3001);
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

  it("после возврата адрес проверяется — ответ попадает в urlCheck", async () => {
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-02\n2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-02\n" }],
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-02") }],
        [
          /cat '\/var\/www\/app\/releases\/2025-06-01\/plantar\.pm2\.config\.cjs'/,
          { stdout: '"PORT": 3005' },
        ],
        // The post-rollback smoke check probes the public address
        [/'http:\/\/203\.0\.113\.1\/'/, { code: 0, stdout: "200\n" }],
      ],
      [],
    );

    const result = await rollbackProject(conn, appConfig(), () => {});

    expect(result.url).toBe("http://203.0.113.1/");
    expect(result.urlCheck).toBe("answered");
  });

  it("адрес после возврата молчит — urlCheck «не ответило», сам возврат не падает", async () => {
    const conn = fakeConn(
      [
        [/ls -1 '\/var\/www\/app\/releases'/, { stdout: "2025-06-02\n2025-06-01\n" }],
        [/readlink '\/var\/www\/app\/current'/, { stdout: "releases/2025-06-02\n" }],
        [/pm2 jlist/, { stdout: jlist("/var/www/app/releases/2025-06-02") }],
        [
          /cat '\/var\/www\/app\/releases\/2025-06-01\/plantar\.pm2\.config\.cjs'/,
          { stdout: '"PORT": 3005' },
        ],
        [/'http:\/\/203\.0\.113\.1\/'/, { code: 1, stdout: "000\n" }],
      ],
      [],
    );

    const result = await rollbackProject(conn, appConfig(), () => {});

    expect(result.release).toBe("2025-06-01");
    expect(result.urlCheck).toBe("no-answer");
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

describe("removeDeployedProject: проба pm2 перед удалением файлов", () => {
  it("pm2 недоступен — удаление прерывается, rm -rf не выполняется", async () => {
    const commands: string[] = [];
    // pm2 reports the failure on stdout ([PM2][ERROR] ...), not only stderr
    const conn = fakeConn(
      [
        [
          /^pm2 jlist$/,
          { code: 1, stdout: "[PM2][ERROR] Daemon not running\n", stderr: "connect EAGAIN\n" },
        ],
      ],
      commands,
    );

    await expect(removeDeployedProject(conn, "app")).rejects.toThrow(
      t("pm2Unavailable", { stderr: "[PM2][ERROR] Daemon not running\nconnect EAGAIN" }),
    );
    expect(commands.some((c) => c.includes("rm -rf"))).toBe(false);
    expect(commands.some((c) => c.includes("pm2 delete"))).toBe(false);
    // No daemon was spawned by the probe, so nothing gets killed
    expect(commands).not.toContain("pm2 kill");
  });

  it("pm2 jlist поднял свежий демон (баннер, код 0) — удаление прерывается, rm -rf не выполняется", async () => {
    const commands: string[] = [];
    // A dead daemon respawns on the probe: banner + empty table, exit 0
    const banner = "[PM2] Spawning PM2 daemon with pm2_home=/root/.pm2\n[]";
    const conn = fakeConn([[/^pm2 jlist$/, { stdout: banner }]], commands);

    await expect(removeDeployedProject(conn, "app")).rejects.toThrow(
      t("pm2Unavailable", { stderr: banner }),
    );
    expect(commands.some((c) => c.includes("rm -rf"))).toBe(false);
    expect(commands.some((c) => c.includes("pm2 delete"))).toBe(false);
    // The empty daemon spawned by the probe is killed, so a retry hits the
    // banner again instead of mistaking the clean table for "process absent"
    expect(commands).toContain("pm2 kill");
  });

  it("демон поднят пробой, а pm2 kill упал — всё равно летит ошибка «pm2 недоступен»", async () => {
    const commands: string[] = [];
    const banner = "[PM2] Spawning PM2 daemon with pm2_home=/root/.pm2\n[]";
    // The kill is best-effort: a dropped connection must not mask the error
    const conn = fakeConn(
      [
        [/^pm2 jlist$/, { stdout: banner }],
        [/^pm2 kill$/, new Error("connection lost")],
      ],
      commands,
    );

    await expect(removeDeployedProject(conn, "app")).rejects.toThrow(
      t("pm2Unavailable", { stderr: banner }),
    );
    expect(commands.some((c) => c.includes("rm -rf"))).toBe(false);
  });

  it("процесса нет в pm2 (статический сайт) — файлы удаляются без pm2 delete", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [
        [/^pm2 jlist$/, { stdout: "[]" }],
        // No dump file on the server — nothing for pm2 to resurrect
        [/dump\.pm2/, { stdout: "PLANTAR_NO_DUMP\n" }],
      ],
      commands,
    );

    await removeDeployedProject(conn, "app", (line) => logs.push(line));

    expect(logs).toContain(t("pm2NotFound"));
    expect(commands.some((c) => c.includes("pm2 delete"))).toBe(false);
    expect(commands.some((c) => c.includes("rm -rf '/var/www/app'"))).toBe(true);
    expect(logs).toContain(t("projectRemoved", { name: "app" }));
  });

  it("таблица pm2 пуста, но процесс остался в dump.pm2 — удаление прерывается, rm -rf не выполняется", async () => {
    const commands: string[] = [];
    // An earlier `pm2 jlist` (status polling, an old removal attempt) respawned
    // an empty daemon: clean table, no banner — but the stale dump still holds
    // the process, and a reboot would resurrect it from the deleted directory
    const conn = fakeConn(
      [
        [/^pm2 jlist$/, { stdout: "[]" }],
        [/dump\.pm2/, { stdout: JSON.stringify([{ name: "app", pm_exec_path: "/var/www/app" }]) }],
      ],
      commands,
    );

    await expect(removeDeployedProject(conn, "app")).rejects.toThrow(
      t("pm2DumpStale", { name: "app" }),
    );
    expect(commands.some((c) => c.includes("rm -rf"))).toBe(false);
    expect(commands.some((c) => c.includes("pm2 delete"))).toBe(false);
  });

  it("dump.pm2 держит только чужие процессы — совпадение строго по имени, удаление продолжается", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    // "app" must not match "app-staging" by substring anywhere in the dump JSON
    const conn = fakeConn(
      [
        [/^pm2 jlist$/, { stdout: "[]" }],
        [/dump\.pm2/, { stdout: JSON.stringify([{ name: "app-staging" }, { name: "other" }]) }],
      ],
      commands,
    );

    await removeDeployedProject(conn, "app", (line) => logs.push(line));

    expect(logs).toContain(t("pm2NotFound"));
    expect(commands.some((c) => c.includes("rm -rf '/var/www/app'"))).toBe(true);
  });

  it("dump.pm2 не читается как JSON — состояние pm2 неизвестно, удаление прерывается", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/^pm2 jlist$/, { stdout: "[]" }],
        [/dump\.pm2/, { stdout: "not-json" }],
      ],
      commands,
    );

    await expect(removeDeployedProject(conn, "app")).rejects.toThrow(
      t("pm2Unavailable", { stderr: "not-json" }),
    );
    expect(commands.some((c) => c.includes("rm -rf"))).toBe(false);
  });

  it("dump.pm2 есть, но не читается (код ≠ 0) — удаление прерывается", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/^pm2 jlist$/, { stdout: "[]" }],
        [/dump\.pm2/, { code: 1, stderr: "cat: permission denied" }],
      ],
      commands,
    );

    await expect(removeDeployedProject(conn, "app")).rejects.toThrow(
      t("pm2Unavailable", { stderr: "cat: permission denied" }),
    );
    expect(commands.some((c) => c.includes("rm -rf"))).toBe(false);
  });

  it("процесс есть — pm2 delete и pm2 save перед удалением файлов", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const conn = fakeConn(
      [[/^pm2 jlist$/, { stdout: jlist("/var/www/app/current") }]],
      commands,
    );

    await removeDeployedProject(conn, "app", (line) => logs.push(line));

    expect(commands).toContain("pm2 delete 'app'");
    expect(commands).toContain("pm2 save --force");
    expect(logs).toContain(t("pm2Stopped"));
    const deleteIndex = commands.findIndex((c) => c.includes("pm2 delete"));
    const rmIndex = commands.findIndex((c) => c.includes("rm -rf"));
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(rmIndex).toBeGreaterThan(deleteIndex);
  });
});

describe("getServerInfo", () => {
  /** One check's slice of the combined command output */
  const section = (name: string, output: string, code = 0) =>
    `__PLANTAR_SECTION__${name}\n${output ? output + "\n" : ""}__PLANTAR_EXIT__${code}\n`;

  it("собирает все проверки одной командой и разбирает совмещённый вывод", async () => {
    const commands: string[] = [];
    const stdout =
      section(
        "os-release",
        'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"',
      ) +
      section("nproc", "4") +
      section("meminfo", "MemTotal:       16384000 kB") +
      section("disk", "52428800") +
      // Output without a trailing newline glues the exit marker to the same line
      "__PLANTAR_SECTION__tool:node\nv22.1.0__PLANTAR_EXIT__0\n" +
      section("tool:pnpm", "9.1.0") +
      section("tool:pm2", "5.4.0") +
      // nginx prints its version to stderr; 2>&1 folds it into the section output
      section("tool:nginx", "nginx version: nginx/1.24.0") +
      section("tool:certbot", "bash: certbot: command not found", 127) +
      section("tool:python", "", 1);
    const conn = fakeConn([[/__PLANTAR_SECTION__/, { stdout }]], commands);

    const info = await getServerInfo(conn);

    expect(commands).toHaveLength(1);
    expect(info).toEqual({
      os: { id: "ubuntu", version: "24.04", pretty: "Ubuntu 24.04.1 LTS" },
      supported: true,
      cpuCores: 4,
      memoryTotalMb: 16000,
      diskFreeRootGb: 50,
      tools: {
        node: "v22.1.0",
        pnpm: "9.1.0",
        pm2: "5.4.0",
        nginx: "nginx version: nginx/1.24.0",
        certbot: null,
        python: null,
      },
    });
  });

  it("обрыв канала посреди команды — ошибка, а не частичные данные", async () => {
    // The combined command always exits 0 by itself (it ends with an echo),
    // so a non-zero/-1 code means the transport dropped mid-run
    const stdout = section("os-release", "ID=ubuntu") + section("nproc", "4");
    const conn = fakeConn([[/__PLANTAR_SECTION__/, { stdout, code: -1 }]], []);

    await expect(getServerInfo(conn)).rejects.toThrow(/-1/);
  });

  it("команда проходит синтаксическую проверку bash", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "plantar-")), "server-info.sh");
    writeFileSync(file, serverInfoCommand());
    expect(() => execFileSync("bash", ["-n", file])).not.toThrow();
  });

  it("реальный запуск команды: каждая проверка получает свою секцию и код", () => {
    // Missing tools and files are fine here — the point is that the real shell
    // output splits back into one section with a numeric exit code per check
    const stdout = execFileSync("bash", ["-c", serverInfoCommand()], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sections = parseServerInfoOutput(stdout);
    for (const name of [
      "os-release",
      "nproc",
      "meminfo",
      "disk",
      "tool:node",
      "tool:pnpm",
      "tool:pm2",
      "tool:nginx",
      "tool:certbot",
      "tool:python",
    ]) {
      expect(sections.has(name), name).toBe(true);
      expect(sections.get(name)!.code, name).toBeGreaterThanOrEqual(0);
    }
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

describe("logStreamCommand", () => {
  it("пути к логам pm2 в кавычках, $HOME остаётся раскрываемым", () => {
    const command = logStreamCommand("app", "site");
    expect(command).toContain(`"$HOME/.pm2/logs/"'site-out.log'`);
    expect(command).toContain(`"$HOME/.pm2/logs/"'site-error.log'`);
  });

  it("пути к логам nginx в кавычках", () => {
    const command = logStreamCommand("nginx", "site");
    expect(command).toContain("'/var/log/nginx/site.access.log'");
    expect(command).toContain("'/var/log/nginx/site.error.log'");
  });

  it("апостроф в имени приложения экранируется, а не ломает команду", () => {
    expect(logStreamCommand("app", "o'brien")).toContain(
      `"$HOME/.pm2/logs/"'o'\\''brien-out.log'`,
    );
  });
});
