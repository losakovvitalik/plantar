import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { SshConnection } from "@plantar/ssh";
import { parseProjectConfig, type ProjectConfig } from "@plantar/config";
import {
  deployProject,
  listReleases,
  parsePm2Jlist,
  rollbackProject,
} from "../../src/index";
import { SSH_PASSWORD, SSH_USER } from "./global-setup";

/**
 * Deploy flows of packages/core against a real Ubuntu server (the Docker
 * fixture from global-setup): real sshd, nginx, pm2 and shell — no stubs.
 * The scenarios share one server and one app and run in order.
 */

const APP_NAME = "it-app";

/** Writes the small Node fixture app that answers every request with `body` */
function writeFixtureApp(dir: string, body: string): void {
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: APP_NAME, private: true }, null, 2) + "\n",
  );
  writeFileSync(
    path.join(dir, "server.js"),
    `const http = require("node:http");\n` +
      `http.createServer((req, res) => res.end(${JSON.stringify(body)}))` +
      `.listen(process.env.PORT || 3000);\n`,
  );
}

/** A build that starts and dies immediately — the deploy must fail on it */
function writeCrashingApp(dir: string): void {
  writeFixtureApp(dir, "never");
  writeFileSync(path.join(dir, "server.js"), `process.exit(1);\n`);
}

describe("deploy core over real SSH", () => {
  let conn: SshConnection;
  let projectDir: string;
  let config: ProjectConfig;
  let firstRelease: string;
  // Set PLANTAR_IT_DEBUG=1 to see the deploy command trail when a scenario fails
  const log = process.env.PLANTAR_IT_DEBUG
    ? (line: string) => console.log(line)
    : () => {};

  const appUrl = () => `http://127.0.0.1:${inject("httpPort")}/`;

  /** Asserts what the app answers through the host-mapped nginx port.
   *  Polls briefly: `nginx -s reload` is asynchronous, so right after a
   *  deploy the previous configuration may still answer for a moment. */
  async function expectHttpBody(expected: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    for (;;) {
      try {
        last = await (await fetch(appUrl())).text();
        if (last === expected) return;
      } catch {
        // nginx may be mid-reload — retry below
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(last).toBe(expected);
  }

  beforeAll(async () => {
    conn = await SshConnection.connect({
      host: "127.0.0.1",
      port: inject("sshPort"),
      username: SSH_USER,
      password: SSH_PASSWORD,
    });
    projectDir = mkdtempSync(path.join(tmpdir(), "plantar-it-app-"));
    config = parseProjectConfig({
      name: APP_NAME,
      type: "node",
      packageManager: "npm",
      startCommand: "node server.js",
    });
  });

  afterAll(() => {
    conn?.close();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it("deploys a Node app: release, current symlink, pm2 online, HTTP answer", async () => {
    writeFixtureApp(projectDir, "release-1");
    const result = await deployProject(conn, projectDir, config, log);

    expect(result.port).toBeDefined();
    expect(result.urlCheck).toBe("answered");
    // The desktop app persists the assigned port after the first deploy —
    // keep it stable for the redeploy/rollback scenarios below
    config = { ...config, port: result.port };

    const { releases, current } = await listReleases(conn, APP_NAME);
    expect(releases).toHaveLength(1);
    expect(current).toBe(releases[0]);
    firstRelease = releases[0];

    const link = await conn.exec(`readlink '/var/www/${APP_NAME}/current'`);
    expect(link.stdout.trim()).toBe(`releases/${firstRelease}`);

    const app = parsePm2Jlist((await conn.exec("pm2 jlist")).stdout).find(
      (p) => p.name === APP_NAME,
    );
    expect(app?.status).toBe("online");
    expect(app?.cwd).toContain(`/releases/${firstRelease}`);

    // Through the host-mapped nginx port — the whole chain must answer
    await expectHttpBody("release-1");
  });

  it("redeploys and rolls back to the previous release", async () => {
    writeFixtureApp(projectDir, "release-2");
    await deployProject(conn, projectDir, config, log);

    const afterRedeploy = await listReleases(conn, APP_NAME);
    expect(afterRedeploy.releases).toHaveLength(2);
    expect(afterRedeploy.current).not.toBe(firstRelease);
    await expectHttpBody("release-2");

    const rollback = await rollbackProject(conn, config, log);
    expect(rollback.release).toBe(firstRelease);

    const afterRollback = await listReleases(conn, APP_NAME);
    expect(afterRollback.current).toBe(firstRelease);
    await expectHttpBody("release-1");
  });

  it("keeps the previous release serving after a failed deploy", async () => {
    writeCrashingApp(projectDir);
    await expect(deployProject(conn, projectDir, config, log)).rejects.toThrow();

    // The recovery path restarted the last working release
    const app = parsePm2Jlist((await conn.exec("pm2 jlist")).stdout).find(
      (p) => p.name === APP_NAME,
    );
    expect(app?.status).toBe("online");
    expect(app?.cwd).toContain(`/releases/${firstRelease}`);

    // current still points at the working release and it still serves
    const { current } = await listReleases(conn, APP_NAME);
    expect(current).toBe(firstRelease);
    await expectHttpBody("release-1");
  });
});
