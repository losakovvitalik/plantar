import type { HostKey } from "@plantar/ssh";
import { sendToWindow } from "./ipc/util";
import { activeWindow } from "./window";

/**
 * Which servers answered with a host key other than the recorded one, and which
 * key each of them answered with — the one place in main that keeps that fact.
 *
 * It has to outlive the operation that ran into it. The window can be closed to
 * the tray while the background monitor finds the mismatch, and the push event
 * below then has nowhere to go; a window opening later asks for the list
 * instead of learning nothing about it.
 *
 * The key comes along because the rejected handshake is the only place it is
 * seen: offering to record it as the server's new key must not need a second
 * connection, which would be a connection to a server the app is refusing.
 *
 * Nothing is written to disk: the handshake turns the connection down on its
 * own, restart or not, so after a restart the next connection to that server
 * establishes the fact again — one warning less, never one connection more.
 */
const inQuestion = new Map<string, HostKey>();

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
export function reportIdentityChanged(serverId: string, hostKey: HostKey): boolean {
  const known = inQuestion.has(serverId);
  // Always the key of the latest attempt, even when the fact itself is old
  // news: what the user is offered to record has to be what the server answers
  // with now, not the first key of the episode
  inQuestion.set(serverId, hostKey);
  if (known) return false;
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

/**
 * Drops the question about this server without answering it — for the record
 * that is being deleted, where there is nothing to announce. A settle tells the
 * window the server presented its recorded key; a server that is going away
 * presented nothing, and the event would reach the renderer before the removal
 * call returns, while it still holds the pre-removal list: every remaining
 * server would blink into the checking state and the deleted one would be asked
 * for its app statuses.
 */
export function forgetIdentityQuestion(serverId: string): void {
  inQuestion.delete(serverId);
  warned.delete(serverId);
}

/**
 * The server presented the recorded key again — the question is settled, and an
 * open window is told so. The window cannot find that out on its own: its
 * status sweep never connects to a password server, and the operations that do
 * (reading server info, discovering apps, browsing files) refresh no status —
 * the warning would outlive its reason until the next mount or deploy, while
 * operations on that server visibly succeed.
 *
 * Only a server that actually leaves the list is announced. Every successful
 * connection settles the question (connections.ts) and almost none of them are
 * to a server that was in question, so an unconditional push would fire on
 * every connect.
 */
export function clearIdentityChanged(serverId: string): void {
  const wasInQuestion = inQuestion.has(serverId);
  forgetIdentityQuestion(serverId);
  if (!wasInQuestion) return;
  const win = activeWindow();
  if (win) sendToWindow(win, "server:identity-settled", { serverId });
}

/** Servers whose identity is in question — for a window that is only now opening */
export function identityChangedServers(): string[] {
  return [...inQuestion.keys()];
}

/**
 * The key this server answers with while its identity is in question — the one
 * the user is shown and asked to confirm. undefined once the question is
 * settled, which is what stops a confirmation left open on screen from
 * recording a key the server no longer presents.
 */
export function presentedHostKey(serverId: string): HostKey | undefined {
  return inQuestion.get(serverId);
}
