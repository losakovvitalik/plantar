import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type Page, chromium } from "playwright-core";

/**
 * Launches the built desktop app for an e2e run and attaches Playwright to
 * its renderer over CDP.
 *
 * Technique notes (all verified against this app):
 * - `_electron.launch` hangs on the DevTools socket here, so the app is
 *   spawned manually with `--remote-debugging-port` and attached to with
 *   `chromium.connectOverCDP`.
 * - HOME points at a fresh temp directory, so the app starts in a true
 *   first-run state and never touches real user data.
 * - `--use-mock-keychain` is mandatory: with a fake HOME the real keychain
 *   hangs `safeStorage` checks in the main process on startup.
 */

const require = createRequire(import.meta.url);

export interface LaunchedApp {
  page: Page;
  /** Kills the app and removes its fake HOME */
  close: () => Promise<void>;
}

/** Resolves a free localhost port by binding to port 0 and releasing it */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("could not allocate a free port")));
      }
    });
  });
}

/** Polls `check` until it passes; fails with a message naming what stalled */
async function waitUntil(
  what: string,
  timeoutMs: number,
  check: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Spawns the app with the folder picker stubbed to `pickDir` (see
 * electron-entry.cjs) and returns the renderer page.
 */
export async function launchApp(pickDir: string): Promise<LaunchedApp> {
  const e2eDir = path.dirname(fileURLToPath(import.meta.url));
  // Under plain Node the electron package resolves to the binary path
  const electronBinary = require("electron") as unknown as string;
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), "plantar-e2e-home-"));
  const cdpPort = await freePort();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fakeHome,
    PLANTAR_E2E_PICK_DIR: pickDir,
  };
  // Inherited from IDE terminals; with it Electron starts as plain Node
  delete env.ELECTRON_RUN_AS_NODE;
  // Would make the app load a dev server instead of the built renderer
  delete env.ELECTRON_RENDERER_URL;

  const child: ChildProcess = spawn(
    electronBinary,
    [
      path.join(e2eDir, "electron-entry.cjs"),
      `--remote-debugging-port=${cdpPort}`,
      "--use-mock-keychain",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );

  // Keep a bounded tail of the app's output to attach to launch-failure
  // errors — without it a crash on startup surfaces only as a CDP timeout.
  let outputTail = "";
  const collectOutput = (chunk: Buffer): void => {
    outputTail = (outputTail + chunk.toString()).slice(-4000);
  };
  child.stdout?.on("data", collectOutput);
  child.stderr?.on("data", collectOutput);

  const killApp = async (): Promise<void> => {
    if (child.exitCode === null && !child.killed) {
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, 5000);
      });
      child.kill("SIGKILL");
      await exited;
    }
    rmSync(fakeHome, { recursive: true, force: true });
  };

  let browser: Browser | undefined;
  try {
    await waitUntil("the DevTools endpoint of the spawned app", 30_000, async () => {
      try {
        return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
      } catch {
        return false;
      }
    });

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    let page: Page | undefined;
    await waitUntil("the renderer window of the app", 30_000, async () => {
      page = browser!
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().includes("/out/renderer/"));
      return page !== undefined;
    });

    return {
      page: page!,
      close: async () => {
        await browser?.close().catch(() => {});
        await killApp();
      },
    };
  } catch (err) {
    await browser?.close().catch(() => {});
    await killApp();
    if (err instanceof Error && outputTail !== "") {
      err.message += `\nApp output tail:\n${outputTail}`;
    }
    throw err;
  }
}
