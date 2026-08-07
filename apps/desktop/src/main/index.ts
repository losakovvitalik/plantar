import { BrowserWindow, Notification, app } from "electron";
import { readSettings, writeSettings } from "@plantar/storage";
import { collectServerAppStatuses } from "./app-statuses";
import { setLanguage, t } from "./i18n";
import { registerDeployIpc } from "./ipc/deploy";
import { registerEnvIpc } from "./ipc/env";
import { registerFilesIpc } from "./ipc/files";
import { registerGithubIpc } from "./ipc/github";
import { registerHistoryIpc } from "./ipc/history";
import { registerLogsIpc } from "./ipc/logs";
import { registerMetricsIpc } from "./ipc/metrics";
import { registerProjectsIpc } from "./ipc/projects";
import { registerServersIpc } from "./ipc/servers";
import { registerSettingsIpc } from "./ipc/settings";
import { registerShellIpc } from "./ipc/shell";
import { syncMcpServer } from "./mcp";
import { mcpProvider } from "./mcp-provider";
import { startAppMonitor, stopAppMonitor } from "./app-monitor";
import { migratePlainKeys } from "./ssh-setup";
import { createAppTray, destroyTray } from "./tray";
import { createWindow, openFromBackground } from "./window";

// Без AppUserModelId уведомления на Windows не показываются; должен совпадать с appId сборки
if (process.platform === "win32") app.setAppUserModelId("com.plantar.desktop");

app.whenReady().then(() => {
  setLanguage(readSettings().language);
  migratePlainKeys();
  createWindow();

  // The MCP endpoint outlives restarts: settings enabled it, so bring it up.
  // A failure (say, the port is taken) must not break startup — but the stored
  // toggle must not keep claiming the server is up when nothing is listening,
  // so it is turned off; re-enabling in settings reuses the saved token (#43)
  syncMcpServer(readSettings(), mcpProvider)
    .then((port) => {
      // A bind conflict falls back to a free port — persist it so the address
      // stays stable across restarts (#44). Settings are re-read right before
      // the write so a concurrent settings:set is not clobbered.
      if (port === null) return;
      const current = readSettings();
      if (current.mcpServerPort !== port) writeSettings({ ...current, mcpServerPort: port });
    })
    .catch((err) => {
      console.error("plantar: MCP server failed to start", err);
      const current = readSettings();
      if (current.mcpServerEnabled) writeSettings({ ...current, mcpServerEnabled: false });
    });

  registerSettingsIpc();
  registerGithubIpc();
  registerServersIpc();
  registerProjectsIpc();
  registerEnvIpc();
  registerFilesIpc();
  registerHistoryIpc();
  registerMetricsIpc();
  registerDeployIpc();
  registerLogsIpc();
  registerShellIpc();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Last, and each in its own try/catch: a tray that some Linux desktops cannot
  // create, or a broken status cache, must not leave the app without the IPC
  // handlers registered above — the window would open and every action fail
  try {
    // The tray keeps the app alive with the window closed — the background
    // monitor works on every platform, and the app can be reopened or quit
    createAppTray(() => openFromBackground());
  } catch (err) {
    console.error("[tray] init failed:", err);
  }
  try {
    startAppMonitor({
      collectStatuses: collectServerAppStatuses,
      openFromBackground,
    });
  } catch (err) {
    console.error("[monitor] init failed:", err);
  }
});

// Closing the window no longer quits the app: the background monitor keeps
// working from the tray. On Windows/Linux this changes the familiar behavior,
// so the first close of a session is explained with a notification.
let trayNoticeShown = false;
app.on("window-all-closed", () => {
  if (process.platform === "darwin" || trayNoticeShown) return;
  trayNoticeShown = true;
  if (!Notification.isSupported()) return;
  new Notification({
    title: t("trayBackgroundTitle"),
    body: t("trayBackgroundBody"),
  }).show();
});

app.on("before-quit", () => {
  stopAppMonitor();
  destroyTray();
});
