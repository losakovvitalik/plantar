import { shell } from "electron";
import { handle, toResult } from "./util";

export function registerShellIpc(): void {
  // Defense in depth: only web links leave the app — file:// or a custom
  // scheme could trigger an arbitrary protocol handler on the user's machine.
  // A blocked URL stays a silent no-op, but now resolves to a proper
  // IpcResult<void> instead of the bare undefined the .d.ts never declared
  handle("open-external", (_e, url) =>
    toResult(async () => {
      let protocol: string;
      try {
        protocol = new URL(url).protocol;
      } catch {
        console.warn("open-external: blocked url", url);
        return;
      }
      if (protocol !== "http:" && protocol !== "https:") {
        console.warn("open-external: blocked url", url);
        return;
      }
      await shell.openExternal(url);
    }),
  );
}
