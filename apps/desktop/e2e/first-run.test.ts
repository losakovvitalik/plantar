import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { SSH_PASSWORD, SSH_USER } from "./global-setup";
import { type LaunchedApp, launchApp } from "./launch-app";

/**
 * First-run happy path, the product's core promise: an empty app connects a
 * server, adds a project and deploys it — all through the real UI, against
 * the disposable Docker server fixture. Controls are addressed by
 * data-testid only, so i18n edits cannot break the scenario.
 */

const APP_NAME = "e2e-app";
const HTTP_BODY = "plantar-e2e-ok";

/** The small Node fixture app the scenario deploys */
function writeFixtureApp(dir: string): void {
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: APP_NAME, private: true }, null, 2) + "\n",
  );
  writeFileSync(
    path.join(dir, "server.js"),
    `const http = require("node:http");\n` +
      `http.createServer((req, res) => res.end(${JSON.stringify(HTTP_BODY)}))` +
      `.listen(process.env.PORT || 3000);\n`,
  );
}

/** Runs an action and names the failed step in the error — no anonymous timeouts */
async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    throw new Error(`Step "${name}" failed: ${(err as Error).message}`);
  }
}

/** Last lines of the deploy terminal — context for deploy failures */
async function deployLogTail(page: Page): Promise<string> {
  const text = await page
    .locator('[data-testid="deploy-log"]')
    .innerText({ timeout: 5000 })
    .catch(() => "");
  return text.split("\n").slice(-15).join("\n");
}

/** Waits for the deploy run to succeed; fails fast when the run errors out */
async function waitForDeploySuccess(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await page
      .locator('[data-testid="deploy-tab"]')
      .getAttribute("data-run-status", { timeout: 5000 });
    if (status === "success") return;
    if (status === "error" || status === "interrupted") {
      throw new Error(
        `Step "wait for the deploy to succeed" failed: the run finished with ` +
          `status "${status}".\nDeploy log tail:\n${await deployLogTail(page)}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Step "wait for the deploy to succeed" stalled after ${timeoutMs} ms ` +
          `(status "${status}").\nDeploy log tail:\n${await deployLogTail(page)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

let app: LaunchedApp | undefined;
let projectDir: string;

beforeAll(async () => {
  projectDir = mkdtempSync(path.join(os.tmpdir(), "plantar-e2e-app-"));
  writeFixtureApp(projectDir);
  app = await launchApp(projectDir);
});

afterAll(async () => {
  await app?.close();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

it("connects a server, adds an app and deploys it through the UI", async () => {
  const page = app!.page;
  page.setDefaultTimeout(15_000);
  const tid = (id: string) => page.locator(`[data-testid="${id}"]`);

  // Connect the fixture server through the form. The default auth mode uses
  // the password once to install a dedicated key — the first-run golden path.
  await step("open the add-server form", () => tid("sidebar-add-server").click());
  await step("fill the server form", async () => {
    await tid("server-host").fill("127.0.0.1");
    await tid("server-port").fill(String(inject("sshPort")));
    await tid("server-user").fill(SSH_USER);
    await tid("server-password").fill(SSH_PASSWORD);
  });
  await step("connect the server", () => tid("server-submit").click());
  await step("see the server in the sidebar", () =>
    tid("sidebar-server").waitFor({ timeout: 60_000 }),
  );

  // Add the project. The native folder picker is stubbed in electron-entry.cjs
  // and returns the fixture app directory.
  await step("open the add-project dialog", async () => {
    await tid("sidebar-server").hover();
    await tid("sidebar-add-project").click();
  });
  await step("choose the local-folder source", () => tid("add-project-local").click());
  await step("fill the project settings", async () => {
    await tid("project-type-node").click();
    await tid("project-name").fill(APP_NAME);
    await tid("project-start-command").fill("node server.js");
  });
  await step("add the project", () => tid("project-submit").click());
  await step("see the project screen", () => tid("tab-status").waitFor());

  // Deploy from the UI and wait for the run to report success
  await step("open the Deploy tab", () => tid("tab-deploy").click());
  await step("start the deploy", () => tid("deploy-start").click({ timeout: 30_000 }));
  await waitForDeploySuccess(page, 300_000);

  // The deploy must have actually worked, not just reported success: the app
  // answers over HTTP through the fixture's mapped nginx port. Polled briefly —
  // `nginx -s reload` is asynchronous.
  const url = `http://127.0.0.1:${inject("httpPort")}/`;
  await step("get an HTTP answer from the deployed app", async () => {
    const deadline = Date.now() + 30_000;
    let last = "";
    for (;;) {
      try {
        last = await (await fetch(url)).text();
        if (last === HTTP_BODY) return;
      } catch {
        // nginx may be mid-reload — retry below
      }
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(last).toBe(HTTP_BODY);
  });

  // The Status tab (the app's primary screen) shows the app as running
  await step("open the Status tab", () => tid("tab-status").click());
  await step("see the running badge on the Status tab", () =>
    page
      .locator('[data-testid="app-health-state"][data-state="running"]')
      .waitFor({ timeout: 120_000 }),
  );
});
