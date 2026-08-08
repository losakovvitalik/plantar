import { shell } from "electron";
import { t } from "../i18n";
import { handle, toResult } from "./util";

/** Protocol of the URL, or null when the string is not a URL at all */
function urlProtocol(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

export function registerShellIpc(): void {
  // Defense in depth: only web links leave the app — file:// or a custom
  // scheme could trigger an arbitrary protocol handler on the user's machine.
  // A blocked URL fails the call: resolving as { ok: true } would make it
  // indistinguishable from an opened link for the caller
  handle("open-external", (_e, url) =>
    toResult(async () => {
      const protocol = urlProtocol(url);
      if (protocol !== "http:" && protocol !== "https:") {
        console.warn("open-external: blocked url", url);
        throw new Error(t("externalLinkBlocked"));
      }
      await shell.openExternal(url);
    }),
  );
}
