import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../shared/ipc";
import { t } from "../i18n";
import { registerShellIpc } from "./shell";

type Handler = (event: unknown, args: string) => Promise<IpcResult<void>>;

const { openExternal, handlers } = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(),
  handlers: new Map<string, unknown>(),
}));

vi.mock("electron", () => ({
  shell: { openExternal },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

registerShellIpc();

function invokeOpenExternal(url: string): Promise<IpcResult<void>> {
  const handler = handlers.get("open-external") as Handler | undefined;
  if (!handler) throw new Error("open-external handler was not registered");
  return handler({}, url);
}

describe("open-external", () => {
  beforeEach(() => {
    openExternal.mockReset();
    openExternal.mockResolvedValue(undefined);
    // The handler warns about every blocked url — keep the test output clean
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("opens a web link and reports success", async () => {
    await expect(invokeOpenExternal("https://example.com/")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
  });

  it.each([
    ["an unparsable string", "not a url"],
    ["a file link", "file:///etc/passwd"],
    ["a custom scheme", "myapp://run"],
  ])("reports a blocked link for %s and does not open it", async (_case, url) => {
    await expect(invokeOpenExternal(url)).resolves.toEqual({
      ok: false,
      error: t("externalLinkBlocked"),
      code: undefined,
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
