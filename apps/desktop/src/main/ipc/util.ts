import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { IpcEventMap, IpcInvokeMap, IpcResult } from "../../shared/ipc";

/**
 * Registers an invoke handler pinned to the shared IPC registry: the channel
 * must exist in IpcInvokeMap, the callback receives that channel's args type
 * and must resolve to its result wrapped in IpcResult — so a handler drifting
 * from the contract (which the preload side is checked against too) fails
 * typecheck.
 */
export function handle<C extends keyof IpcInvokeMap>(
  channel: C,
  fn: (
    event: IpcMainInvokeEvent,
    args: IpcInvokeMap[C]["args"],
  ) => Promise<IpcResult<IpcInvokeMap[C]["result"]>>,
): void {
  ipcMain.handle(channel, fn);
}

/** Typed push event to one window: channel and payload must match IpcEventMap */
export function sendToWindow<C extends keyof IpcEventMap>(
  win: BrowserWindow,
  channel: C,
  payload: IpcEventMap[C],
): void {
  win.webContents.send(channel, payload);
}

export async function toResult<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // code — машинный код ошибки (например npm-peer-conflict); GUI по нему предлагает действие
    return { ok: false, error: (err as Error).message, code: (err as { code?: string }).code };
  }
}
