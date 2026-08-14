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

/** Servers the user has already been warned about by a system notification —
 *  once per episode. Lives next to inQuestion and is drained with it, so an
 *  episode settled by any successful connection re-arms the warning */
const warned = new Set<string>();

/**
 * Records that this server's identity is in question and tells the window, if
 * one is open. Returns true when the fact is news — the background monitor uses
 * it to warn once instead of on every sweep. The event goes out on the same
 * terms: a window that already has the server on its list learns nothing from
 * hearing about it again on every sweep, and one opening later asks for the
 * list anyway.
 */
export function reportIdentityChanged(serverId: string): boolean {
  if (inQuestion.has(serverId)) return false;
  inQuestion.add(serverId);
  const win = activeWindow();
  if (win) sendToWindow(win, "server:identity-changed", { serverId });
  return true;
}

/**
 * Whether the user still has to be told about this server by a system
 * notification — true once per episode, an episode being one stay on the
 * inQuestion list. The background monitor asks this instead of keeping its own
 * flag: the answer of reportIdentityChanged cannot serve, because the
 * connection the sweep makes reports the mismatch itself before the error gets
 * to the monitor (connections.ts), so there the fact is never news. A flag of
 * the monitor's own would go stale — an episode settled by a successful
 * foreground connection would not drain it, and a second key change before the
 * next successful sweep would never be notified with the window closed.
 */
export function shouldWarnIdentityChanged(serverId: string): boolean {
  if (!inQuestion.has(serverId) || warned.has(serverId)) return false;
  warned.add(serverId);
  return true;
}

/** The server presented the recorded key again — the question is settled */
export function clearIdentityChanged(serverId: string): void {
  inQuestion.delete(serverId);
  warned.delete(serverId);
}

/** Servers whose identity is in question — for a window that is only now opening */
export function identityChangedServers(): string[] {
  return [...inQuestion];
}
