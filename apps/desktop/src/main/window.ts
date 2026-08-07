import path from "node:path";
import { BrowserWindow } from "electron";
import { sendToWindow } from "./ipc/util";
import { stopAllLogStreams } from "./log-streams";

/**
 * Живое окно на момент вызова. IPC-обработчики регистрируются один раз,
 * а окно на macOS может быть закрыто и создано заново из дока — захваченная
 * в замыкание ссылка после этого указывает на уничтоженное окно.
 */
export function activeWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ??
    null
  );
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: "Plantar",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      // The preload only needs contextBridge/ipcRenderer, so the renderer can
      // run inside the Chromium sandbox instead of the default `sandbox: false`
      sandbox: true,
    },
  });

  // При перезагрузке renderer или закрытии окна подписчики пропадают —
  // останавливаем осиротевшие стримы, чтобы не держать SSH-соединения занятыми.
  // Вешаем при создании: окно на macOS может пересоздаваться
  win.webContents.on("did-navigate", stopAllLogStreams);
  win.on("closed", stopAllLogStreams);

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}

/**
 * Brings the window up from the background (creating it if it was closed into
 * the tray) and, if a project is given, opens it. The open-project event for a
 * freshly created window is buffered by the preload until the renderer mounts.
 */
export function openFromBackground(projectId?: string): void {
  const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const win = existing ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!projectId) return;
  const send = (): void => {
    sendToWindow(win, "deploy:open-project", { projectId });
  };
  // A window created just now has no renderer frame yet — a send in this tick
  // goes nowhere, there is not even a preload to buffer it. Wait for the load;
  // from there the preload buffer covers the gap until the renderer subscribes
  if (!existing || win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}
