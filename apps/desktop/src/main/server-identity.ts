import { sendToWindow } from "./ipc/util";
import { activeWindow } from "./window";

/**
 * Which servers answered with a host key other than the recorded one — the one
 * place in main that keeps that fact.
 *
 * It has to outlive the operation that ran into it. The window can be closed to
 * the tray while the background monitor finds the mismatch, and the push event
 * below then has nowhere to go; a window opening later asks for the list
 * instead of learning nothing about it.
 *
 * Nothing is written to disk: the handshake turns the connection down on its
 * own, restart or not, so after a restart the next connection to that server
 * establishes the fact again — one warning less, never one connection more.
 */
const inQuestion = new Set<string>();

/**
 * Records that this server's identity is in question and tells the window, if
 * one is open. Returns true when the fact is news — the background monitor uses
 * it to warn once instead of on every sweep.
 */
export function reportIdentityChanged(serverId: string): boolean {
  const win = activeWindow();
  if (win) sendToWindow(win, "server:identity-changed", { serverId });
  if (inQuestion.has(serverId)) return false;
  inQuestion.add(serverId);
  return true;
}

/** The server presented the recorded key again — the question is settled */
export function clearIdentityChanged(serverId: string): void {
  inQuestion.delete(serverId);
}

/** Servers whose identity is in question — for a window that is only now opening */
export function identityChangedServers(): string[] {
  return [...inQuestion];
}
