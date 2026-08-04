import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshConnection } from "@plantar/ssh";
import { t } from "./messages";
import { addAccessLogDirective, enableExternalAccessLog } from "./nginx-external";

const LOG = "/var/log/nginx/academicals.access.log";

describe("addAccessLogDirective", () => {
  it("adds the directive to the server block that proxies to the app port", () => {
    const conf = `server {
    listen 80;
    server_name academicals.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(1);
    expect(content).toBe(`server {
    access_log ${LOG};
    listen 80;
    server_name academicals.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}`);
  });

  it("patches every block that proxies to the port, skipping redirect-only blocks", () => {
    // The real academicals.ru layout: an http→https redirect block plus an
    // ssl block that actually serves the traffic
    const conf = `server {
    listen 80;
    server_name academicals.ru www.academicals.ru;
    return 301 https://academicals.ru$request_uri;
}

server {
    listen 443 ssl;
    server_name academicals.ru;
    location / {
        proxy_pass http://127.0.0.1:1337;
    }
}`;
    const { content, patched } = addAccessLogDirective(conf, 1337, LOG);
    expect(patched).toBe(1);
    // The redirect block carries no directive — redirect hits are not visits
    expect(content.indexOf(`access_log ${LOG};`)).toBeGreaterThan(
      content.indexOf("return 301"),
    );
  });

  it("leaves blocks with an existing access_log untouched", () => {
    const conf = `server {
    listen 80;
    access_log /var/log/nginx/own.log;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(0);
    expect(content).toBe(conf);
  });

  it("treats access_log off as an existing directive: off cancels other logs", () => {
    const conf = `server {
    listen 80;
    access_log off;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(0);
  });

  it("respects an access_log inside a nested location block", () => {
    const conf = `server {
    listen 80;
    location /api {
        access_log /var/log/nginx/api.log;
        proxy_pass http://127.0.0.1:3000;
    }
}`;
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(0);
  });

  it("ignores server blocks proxying to a different port", () => {
    const conf = `server {
    listen 80;
    server_name other.ru;
    location / { proxy_pass http://127.0.0.1:4000; }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(0);
    expect(content).toBe(conf);
  });

  it("resolves the port through an upstream declared in the same file", () => {
    const conf = `upstream app_backend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name academicals.ru;
    location / {
        proxy_pass http://app_backend;
    }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(1);
    // The upstream block itself must stay untouched
    expect(content).toContain(`upstream app_backend {
    server 127.0.0.1:3000;
}`);
  });

  it("resolves the port through an upstream declared in another file of the config", () => {
    // The upstream lives in a different file of nginx -T, so it is not in
    // confText — it arrives via the config-wide map, the way discovery saw it
    const conf = `server {
    listen 80;
    server_name academicals.ru;
    location / {
        proxy_pass http://app_backend;
    }
}`;
    const configUpstreams = new Map([["app_backend", [3000]]]);
    expect(addAccessLogDirective(conf, 3000, LOG, configUpstreams).patched).toBe(1);
    // Without the config-wide map the upstream name resolves to nothing
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(0);
  });

  it("prefers a same-file upstream declaration over the config-wide map", () => {
    const conf = `upstream app_backend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    location / {
        proxy_pass http://app_backend;
    }
}`;
    // A stale config-wide entry must not hide the same-file declaration
    const configUpstreams = new Map([["app_backend", [4000]]]);
    expect(addAccessLogDirective(conf, 3000, LOG, configUpstreams).patched).toBe(1);
  });

  it("does not count braces inside comments when matching blocks", () => {
    const conf = `server {
    listen 80;
    # a stray brace } in a comment must not end the block
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(1);
    // The comment survives byte for byte
    expect(content).toContain("# a stray brace } in a comment must not end the block");
  });

  it("does not mistake a commented-out access_log for a real one", () => {
    const conf = `server {
    listen 80;
    # access_log /var/log/nginx/old.log;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(1);
  });

  it("matches the indentation of the block's first directive", () => {
    const conf = `server {
  listen 80;
  location / { proxy_pass http://127.0.0.1:3000; }
}`;
    const { content } = addAccessLogDirective(conf, 3000, LOG);
    expect(content).toContain(`server {\n  access_log ${LOG};\n  listen 80;`);
  });

  it("changes nothing else: the original lines survive byte for byte", () => {
    const conf = `# hand-written config, odd formatting kept on purpose
server {
      listen   80 ;
    server_name    academicals.ru;
        location / {
        proxy_pass http://127.0.0.1:3000;
    }
}`;
    const { content } = addAccessLogDirective(conf, 3000, LOG);
    const inserted = `\n      access_log ${LOG};`;
    expect(content.replace(inserted, "")).toBe(conf);
  });
});

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * SSH stub: the first matching rule decides the result; an array value is
 * consumed one result per match (then falls back to success), so a repeated
 * command can fail once and succeed afterwards. Unmatched commands succeed.
 */
function fakeConn(
  rules: Array<[RegExp, Partial<ExecResult> | Array<Partial<ExecResult>>]>,
  commands: string[] = [],
): SshConnection {
  return {
    exec: (command: string) => {
      commands.push(command);
      const outcome = rules.find(([re]) => re.test(command))?.[1];
      const result = Array.isArray(outcome) ? outcome.shift() : outcome;
      return Promise.resolve({ code: 0, stdout: "", stderr: "", ...result });
    },
  } as unknown as SshConnection;
}

describe("enableExternalAccessLog", () => {
  const TARGET = {
    confFile: "/etc/nginx/sites-enabled/site.conf",
    appPort: 3000,
    logPath: "/var/log/nginx/site.access.log",
  };
  const CONF = `server {
    listen 80;
    server_name site.ru;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
  // The timestamped backup path with Date frozen at 2026-08-04T10:00:00Z
  const BACKUP = "/var/www/.plantar/nginx-backups/site.conf.2026-08-04T10-00-00";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-04T10:00:00.000Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function failureMessage(conn: SshConnection): Promise<string> {
    try {
      await enableExternalAccessLog(conn, TARGET);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected enableExternalAccessLog to reject");
  }

  it("resolves when the write, the check and the reload all succeed", async () => {
    const commands: string[] = [];
    const conn = fakeConn([[/^cat /, { stdout: CONF }]], commands);
    await expect(enableExternalAccessLog(conn, TARGET)).resolves.toBeUndefined();
    expect(commands.filter((c) => c === "systemctl reload nginx")).toHaveLength(1);
  });

  it("names the config file and the backup when nginx -t fails and the restore fails too", async () => {
    const stderr = "nginx: [emerg] unexpected end of file";
    const conn = fakeConn([
      [/^cat /, { stdout: CONF }],
      [/^nginx -t$/, { code: 1, stderr }],
      [/^cp /, { code: 1, stderr: "cp: No space left on device" }],
    ]);
    const message = await failureMessage(conn);
    expect(message).toBe(
      t("nginxCheckFailedNotRestored", { file: TARGET.confFile, backup: BACKUP, stderr }),
    );
    // The rendered message really carries the file, the backup path and the
    // original nginx -t failure, and does not claim the file was restored
    expect(message).toContain(TARGET.confFile);
    expect(message).toContain(BACKUP);
    expect(message).toContain(stderr);
    expect(message).not.toBe(t("nginxCheckFailedRestored", { stderr }));
  });

  it("keeps the existing restored message when nginx -t fails and the restore succeeds", async () => {
    const stderr = "nginx: [emerg] unknown directive";
    const conn = fakeConn([
      [/^cat /, { stdout: CONF }],
      [/^nginx -t$/, { code: 1, stderr }],
    ]);
    expect(await failureMessage(conn)).toBe(t("nginxCheckFailedRestored", { stderr }));
  });

  it("reports the failed restore when the write itself fails", async () => {
    const conn = fakeConn([
      [/^cat /, { stdout: CONF }],
      [/base64 -d/, { code: 1, stderr: "write error" }],
      [/^cp /, { code: 1 }],
    ]);
    expect(await failureMessage(conn)).toBe(
      t("accessLogWriteFailedNotRestored", {
        file: TARGET.confFile,
        backup: BACKUP,
        stderr: "write error",
      }),
    );
  });

  it("skips the second reload and reports the failure when the restore copy fails", async () => {
    const stderr = "Job for nginx.service failed";
    const commands: string[] = [];
    const conn = fakeConn(
      [
        [/^cat /, { stdout: CONF }],
        [/^systemctl reload nginx$/, { code: 1, stderr }],
        [/^cp /, { code: 1 }],
      ],
      commands,
    );
    expect(await failureMessage(conn)).toBe(
      t("nginxReloadFailedNotRestored", { file: TARGET.confFile, backup: BACKUP, stderr }),
    );
    // The copy failed, so a second reload would only retry the refused config
    expect(commands.filter((c) => c === "systemctl reload nginx")).toHaveLength(1);
  });

  it("does not claim a rollback when the second reload fails after a restored copy", async () => {
    const stderr = "Job for nginx.service failed";
    const conn = fakeConn([
      [/^cat /, { stdout: CONF }],
      // Both the original reload and the rollback reload fail
      [/^systemctl reload nginx$/, { code: 1, stderr }],
    ]);
    expect(await failureMessage(conn)).toBe(
      t("nginxReloadFailedNotRestored", { file: TARGET.confFile, backup: BACKUP, stderr }),
    );
  });

  it("keeps the restored message when the rollback reloads cleanly", async () => {
    const stderr = "Job for nginx.service failed";
    const conn = fakeConn([
      [/^cat /, { stdout: CONF }],
      // Only the first reload fails; the rollback reload succeeds
      [/^systemctl reload nginx$/, [{ code: 1, stderr }]],
    ]);
    expect(await failureMessage(conn)).toBe(t("nginxReloadFailedRestored", { stderr }));
  });
});
