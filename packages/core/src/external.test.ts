import { describe, expect, it } from "vitest";
import type { SshConnection } from "@plantar/ssh";

import {
  type ExternalTarget,
  deployExternalInPlace,
  getExternalSyncState,
  getExternalVersions,
  parseServerCommits,
  writeExternalEnv,
} from "./external";
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
  } as unknown as SshConnection;
}

const target = (over: Partial<ExternalTarget> = {}): ExternalTarget => ({
  appDir: "/opt/apps/site",
  pm2Name: "old-site",
  branch: "main",
  runtime: "node",
  type: "node",
  port: 3000,
  ...over,
});

/** Запись git log в формате GIT_LOG_FORMAT */
const logRecord = (hash: string, subject: string) =>
  `${hash}\x1f${hash.slice(0, 7)}\x1f${subject}\x1f2025-07-01T10:00:00+03:00\x1fdev\x1e`;

/** Живой процесс в pm2 jlist: NOW заметно позже старта — процесс стабилен */
const STABLE_JLIST = {
  stdout:
    "NOW:100000\n" +
    JSON.stringify([
      { name: "old-bot", pm2_env: { status: "online", pm_uptime: 90000 } },
    ]),
};

describe("parseServerCommits", () => {
  it("разбирает записи с разделителями полей и коммитов", () => {
    const commits = parseServerCommits(
      logRecord("a".repeat(40), "fix: bug") + logRecord("b".repeat(40), "feat: new"),
    );
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: "a".repeat(40),
      shortHash: "aaaaaaa",
      subject: "fix: bug",
      author: "dev",
    });
  });

  it("мусор и пустой вывод дают пустой список", () => {
    expect(parseServerCommits("")).toEqual([]);
    expect(parseServerCommits("fatal: not a git repository")).toEqual([]);
  });
});

describe("getExternalVersions", () => {
  it("папка без git — hasGit=false, версий нет", async () => {
    const conn = fakeConn([[/rev-parse --verify HEAD/, { code: 1 }]], []);
    const versions = await getExternalVersions(conn, "/opt/apps/site", "main");
    expect(versions).toEqual({
      hasGit: false,
      commits: [],
      head: null,
      branchTip: null,
      behindTip: false,
      detached: false,
    });
  });

  it("HEAD отстаёт от вершины ветки, но на ветке — behindTip без detached", async () => {
    const conn = fakeConn(
      [
        [/rev-parse --abbrev-ref HEAD/, { stdout: "main\n" }],
        [/rev-parse --verify HEAD/, { stdout: "a".repeat(40) + "\n" }],
        [/rev-parse --verify 'origin\/main'/, { stdout: "b".repeat(40) + "\n" }],
        [/git .* log /, { stdout: logRecord("b".repeat(40), "feat: new") }],
      ],
      [],
    );
    const versions = await getExternalVersions(conn, "/opt/apps/site", "main");
    expect(versions.behindTip).toBe(true);
    expect(versions.detached).toBe(false);
    expect(versions.head).toBe("a".repeat(40));
    expect(versions.branchTip).toBe("b".repeat(40));
    expect(versions.commits[0].subject).toBe("feat: new");
  });

  it("после возврата версии HEAD отвязан — detached=true", async () => {
    const conn = fakeConn(
      [
        [/rev-parse --abbrev-ref HEAD/, { stdout: "HEAD\n" }],
        [/rev-parse --verify HEAD/, { stdout: "a".repeat(40) + "\n" }],
        [/rev-parse --verify 'origin\/main'/, { stdout: "b".repeat(40) + "\n" }],
        [/git .* log /, { stdout: logRecord("b".repeat(40), "feat") }],
      ],
      [],
    );
    const versions = await getExternalVersions(conn, "/opt/apps/site", "main");
    expect(versions.detached).toBe(true);
    expect(versions.behindTip).toBe(true);
  });

  it("HEAD на вершине ветки — behindTip=false", async () => {
    const conn = fakeConn(
      [
        [/rev-parse --abbrev-ref HEAD/, { stdout: "main\n" }],
        [/rev-parse --verify/, { stdout: "a".repeat(40) + "\n" }],
        [/git .* log /, { stdout: logRecord("a".repeat(40), "feat") }],
      ],
      [],
    );
    const versions = await getExternalVersions(conn, "/opt/apps/site", "main");
    expect(versions.behindTip).toBe(false);
    expect(versions.detached).toBe(false);
  });

  it("сетевые git-команды выполняются без интерактивных вопросов", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/rev-parse --abbrev-ref HEAD/, { stdout: "main\n" }],
        [/rev-parse --verify/, { stdout: "a".repeat(40) + "\n" }],
      ],
      commands,
    );
    await getExternalVersions(conn, "/opt/apps/site", "main");
    const fetch = commands.find((c) => c.includes("fetch"));
    expect(fetch).toContain("GIT_TERMINAL_PROMPT=0");
    expect(fetch).toContain("BatchMode=yes");
  });
});

describe("getExternalSyncState", () => {
  it("одна локальная команда, без fetch и log", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/rev-parse --abbrev-ref HEAD/, { stdout: "HEAD\n" }]], commands);
    const state = await getExternalSyncState(conn, "/opt/apps/site");
    expect(state).toEqual({ hasGit: true, detached: true });
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain("fetch");
  });

  it("на ветке — detached=false; без git — hasGit=false", async () => {
    const onBranch = await getExternalSyncState(
      fakeConn([[/rev-parse/, { stdout: "main\n" }]], []),
      "/opt/apps/site",
    );
    expect(onBranch).toEqual({ hasGit: true, detached: false });
    const noGit = await getExternalSyncState(
      fakeConn([[/rev-parse/, { code: 1 }]], []),
      "/opt/apps/site",
    );
    expect(noGit).toEqual({ hasGit: false, detached: false });
  });
});

describe("deployExternalInPlace: сборка команд", () => {
  it("обычный деплой: checkout ветки + pull, установка по lockfile, сборка, перезапуск под прежним именем", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/^ls -a/, { stdout: "pnpm-lock.yaml\npackage.json\n" }],
        [/cat .*package\.json/, { stdout: '{"scripts":{"build":"tsc"}}' }],
        [/git .* log /, { stdout: logRecord("c".repeat(40), "feat: deploy") }],
      ],
      commands,
    );
    const result = await deployExternalInPlace(conn, target(), () => {});

    const joined = commands.join("\n");
    expect(joined).toContain("git -C '/opt/apps/site' checkout 'main' && ");
    expect(joined).toContain(
      "GIT_SSH_COMMAND='ssh -o BatchMode=yes' git -C '/opt/apps/site' pull --ff-only",
    );
    expect(joined).toContain("cd '/opt/apps/site' && pnpm install");
    expect(joined).toContain(
      "cd '/opt/apps/site' && export NODE_ENV=production && pnpm run build",
    );
    expect(joined).toContain("pm2 restart 'old-site' --update-env");
    // Перезапуск строго после сборки
    const buildAt = commands.findIndex((c) => c.includes("run build"));
    const restartAt = commands.findIndex((c) => c.includes("pm2 restart"));
    expect(buildAt).toBeGreaterThan(-1);
    expect(restartAt).toBeGreaterThan(buildAt);
    expect(result.commit?.subject).toBe("feat: deploy");
  });

  it("без скрипта build сборка пропускается, но перезапуск происходит", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [[/cat .*package\.json/, { stdout: '{"scripts":{"start":"node ."}}' }]],
      commands,
    );
    await deployExternalInPlace(conn, target(), () => {});
    expect(commands.some((c) => c.includes("run build"))).toBe(false);
    expect(commands.some((c) => c.includes("pm2 restart"))).toBe(true);
  });

  it("возврат версии: checkout --detach выбранного коммита вместо pull", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [[/cat .*package\.json/, { stdout: "{}" }]],
      commands,
    );
    await deployExternalInPlace(conn, target(), () => {}, {
      checkout: "d".repeat(40),
    });
    expect(
      commands.some((c) =>
        c.includes(`git -C '/opt/apps/site' checkout --detach '${"d".repeat(40)}'`),
      ),
    ).toBe(true);
    expect(commands.some((c) => c.includes("pull --ff-only"))).toBe(false);
  });

  it("бот: стабильность процесса проверяется по pm2 jlist прежнего имени", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/cat .*package\.json/, { stdout: "{}" }],
        [/pm2 jlist/, STABLE_JLIST],
      ],
      commands,
    );
    await deployExternalInPlace(
      conn,
      target({ type: "bot", pm2Name: "old-bot", port: undefined }),
      () => {},
    );
    expect(commands.some((c) => c.includes("pm2 restart 'old-bot'"))).toBe(true);
  });
});

describe("deployExternalInPlace: неудачи не трогают работающий процесс", () => {
  it("упавшая сборка — ошибка, pm2 restart не выполняется", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/cat .*package\.json/, { stdout: '{"scripts":{"build":"tsc"}}' }],
        [/run build/, { code: 1, stderr: "build-boom" }],
      ],
      commands,
    );
    await expect(deployExternalInPlace(conn, target(), () => {})).rejects.toThrow(
      /build-boom/,
    );
    expect(commands.some((c) => c.includes("pm2 restart"))).toBe(false);
  });

  it("git pull не прошёл (грязная папка) — читаемая ошибка, установка и перезапуск не выполняются", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      [[/pull --ff-only/, { code: 1, stderr: "error: Your local changes…" }]],
      commands,
    );
    await expect(deployExternalInPlace(conn, target(), () => {})).rejects.toThrow(
      /local changes/,
    );
    expect(commands.some((c) => c.includes("install"))).toBe(false);
    expect(commands.some((c) => c.includes("pm2 restart"))).toBe(false);
  });

  it("папка без git — понятная ошибка без каких-либо изменений", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/rev-parse --verify HEAD/, { code: 1 }]], commands);
    await expect(deployExternalInPlace(conn, target(), () => {})).rejects.toThrow(
      t("externalNoGit"),
    );
    expect(commands.some((c) => c.includes("pm2 restart"))).toBe(false);
  });
});

describe("writeExternalEnv", () => {
  it("выбирает файл и пишет одной командой: без гонки и лишнего запроса", async () => {
    const commands: string[] = [];
    const conn = fakeConn([], commands);
    await writeExternalEnv(conn, "/opt/apps/site", "KEY=value\n");
    expect(commands).toHaveLength(1);
    const command = commands[0];
    // Selection happens server-side in the same command as the write
    expect(command).toContain("for f in .env*");
    expect(command).toContain("base64 -d");
    expect(command).toContain('chmod 600 "$target"');
  });

  it("ошибка записи отдаётся читаемым сообщением", async () => {
    const conn = fakeConn([[/base64 -d/, { code: 1, stderr: "disk full" }]], []);
    await expect(writeExternalEnv(conn, "/opt/apps/site", "A=1")).rejects.toThrow(
      /disk full/,
    );
  });
});
