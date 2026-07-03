import os from "node:os";
import path from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import { SshConnection } from "@plantar/ssh";
import { getServerInfo } from "@plantar/core";

interface ConnectionParams {
  host: string;
  port: string;
  user: string;
  password?: string;
  keyPath?: string;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

async function withConnection<T>(
  params: ConnectionParams,
  fn: (conn: SshConnection) => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const conn = await SshConnection.connect({
      host: params.host,
      port: params.port ? Number(params.port) : 22,
      username: params.user,
      password: params.password || undefined,
      privateKeyPath: params.keyPath ? expandHome(params.keyPath) : undefined,
    });
    try {
      return { ok: true, data: await fn(conn) };
    } finally {
      conn.close();
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    title: "Plantar",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("server:info", (_event, params: ConnectionParams) =>
    withConnection(params, (conn) => getServerInfo(conn)),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
