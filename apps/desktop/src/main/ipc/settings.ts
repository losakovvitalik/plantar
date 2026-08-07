import { readSettings, writeSettings } from "@plantar/storage";
import { setLanguage, t } from "../i18n";
import { ensureMcpToken, resolveMcpPort, syncMcpServer } from "../mcp";
import { mcpProvider } from "../mcp-provider";
import { refreshTrayMenu } from "../tray";
import { handle, toResult } from "./util";

export function registerSettingsIpc(): void {
  handle("settings:get", () => toResult(async () => readSettings()));
  handle("settings:set", (_e, settings) =>
    toResult(async () => {
      // The access token appears on first enable and never changes afterwards
      const next = ensureMcpToken(settings);
      // Applies the toggle without an app restart. Sync runs before the write:
      // if the listener fails to start, the toggle is stored as off so the
      // settings never claim the server is up (#43). The other changes are
      // still saved, and the failure surfaces in the dialog as a save error.
      let applied = next;
      let syncError: unknown = null;
      try {
        const port = await syncMcpServer(next, mcpProvider);
        // The listener may sit on a fallback port (the saved one was taken);
        // store the port actually in use so the dialog shows the real
        // address and later starts try it first (#44)
        if (port !== null) applied = { ...applied, mcpServerPort: port };
      } catch (err) {
        syncError = err;
        applied = { ...next, mcpServerEnabled: false };
      }
      writeSettings(applied);
      setLanguage(applied.language);
      refreshTrayMenu();
      if (syncError) {
        console.error("plantar: MCP server failed to start", syncError);
        // Sync can also fail while stopping the listener; the message must
        // match the direction the switch was being moved in
        throw new Error(t(next.mcpServerEnabled ? "mcpStartFailed" : "mcpStopFailed"));
      }
    }),
  );

  // The dialog asks which port the endpoint will actually use before showing
  // the address: the running listener's port, or the stored/default one when
  // a test bind confirms it is free; null — taken, known only on save (#63)
  handle("mcp:resolvePort", () =>
    toResult(() => resolveMcpPort(readSettings().mcpServerPort)),
  );
}
