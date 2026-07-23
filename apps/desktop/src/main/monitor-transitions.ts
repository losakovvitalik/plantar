import type { AppStatus } from "@plantar/storage";

/**
 * Pure logic of the background monitor: compares a fresh observation with the
 * last known state and decides which notifications to send. No side effects —
 * timers, SSH and Notification live in app-monitor.ts.
 */

/** Result of one server sweep: app statuses, or the server did not respond */
export type ServerObservation =
  | { reachable: true; apps: Record<string, AppStatus> }
  | { reachable: false };

/**
 * Health of one app as of the last confirmed check. "downAdopted" — the app was
 * already down when the monitor first saw it (a project added but never
 * deployed, a cache from the previous session): its rise is not a recovery from
 * a fall and must not notify.
 */
export type AppHealth = "up" | "down" | "downAdopted";

/** Last confirmed state of one server */
export interface ServerMonitorState {
  /** projectId → app health (as of the last confirmed check) */
  apps: Record<string, AppHealth>;
  /** Server is unreachable (the user has been notified, or it started that way) */
  unreachable: boolean;
}

/** Down candidates awaiting the confirmation re-check */
export interface PendingCheck {
  /** Apps seen down for the first time */
  downCandidates: string[];
  /** Server seen unreachable for the first time */
  unreachableCandidate: boolean;
}

export interface MonitorNotification {
  kind: "appDown" | "appUp" | "serverUnreachable";
  /** Present for appDown/appUp */
  projectId?: string;
}

export interface TransitionResult {
  state: ServerMonitorState;
  notifications: MonitorNotification[];
  /** Candidates to re-check after a pause; null — no re-check needed */
  recheck: PendingCheck | null;
}

/**
 * Whether the app is up judging by its status; null — the status carries no
 * health information (a static site that has never been checked).
 */
function appIsUp(status: AppStatus): boolean | null {
  if (status === "running") return true;
  if (status === "static") return null;
  return false; // stopped | error | unresponsive
}

/**
 * Compares an observation with the previous server state.
 *
 * pending == null — a regular cycle: "was up → went down" transitions do not
 * notify immediately, they go into recheck for confirmation; "was down → up"
 * notifies right away, but only for a fall the monitor confirmed and announced
 * itself (an app adopted as down rises silently). pending != null
 * — the confirmation re-check: notifications only for the candidates, no new
 * candidates are created (fresh falls wait for the next cycle).
 *
 * prev == null — first run without a cache: the observation is adopted as the
 * baseline, nothing notifies.
 *
 * deploying — projects with a deploy in progress: their statuses are ignored
 * and do not change state (the short downtime of a deploy is not a fall).
 */
export function detectTransitions(
  prev: ServerMonitorState | null,
  observation: ServerObservation,
  pending: PendingCheck | null,
  deploying: ReadonlySet<string>,
): TransitionResult {
  if (!prev) {
    return { state: baseline(observation), notifications: [], recheck: null };
  }

  if (!observation.reachable) {
    if (prev.unreachable) {
      // Already considered unreachable — stay silent until it recovers
      return { state: prev, notifications: [], recheck: null };
    }
    if (pending?.unreachableCandidate) {
      // Unreachability confirmed — one notification instead of N "everything fell"
      return {
        state: { ...prev, unreachable: true },
        notifications: [{ kind: "serverUnreachable" }],
        recheck: null,
      };
    }
    if (pending) {
      // Server vanished between the cycle and the app re-check: candidates are
      // not confirmed; the next cycle will catch the unreachable server
      return { state: prev, notifications: [], recheck: null };
    }
    return {
      state: prev,
      notifications: [],
      recheck: { downCandidates: [], unreachableCandidate: true },
    };
  }

  const notifications: MonitorNotification[] = [];
  const apps: Record<string, AppHealth> = {};
  const downCandidates: string[] = [];

  for (const [projectId, status] of Object.entries(observation.apps)) {
    const was = prev.apps[projectId];
    if (deploying.has(projectId)) {
      if (was !== undefined) apps[projectId] = was;
      continue;
    }
    const up = appIsUp(status);
    if (up === null) {
      if (was !== undefined) apps[projectId] = was;
      continue;
    }
    if (was === undefined) {
      // A new app (or its first meaningful status) — adopt silently
      apps[projectId] = up ? "up" : "downAdopted";
      continue;
    }
    if (was === "up" && !up) {
      if (pending) {
        if (pending.downCandidates.includes(projectId)) {
          // The fall is confirmed by the second check
          apps[projectId] = "down";
          notifications.push({ kind: "appDown", projectId });
        } else {
          // Fell during the re-check window — waits for the next cycle
          apps[projectId] = "up";
        }
      } else {
        // First detection — wait for confirmation, state stays "up" for now
        apps[projectId] = "up";
        downCandidates.push(projectId);
      }
      continue;
    }
    if (was !== "up" && up) {
      apps[projectId] = "up";
      // "Working again" only makes sense after a fall the monitor itself
      // announced: an app adopted as down (a project deployed for the first
      // time) rises silently
      if (was === "down") notifications.push({ kind: "appUp", projectId });
      continue;
    }
    // Still up, or still down — the flavour of "down" is preserved
    apps[projectId] = up ? "up" : was;
  }

  return {
    state: { apps, unreachable: false },
    notifications,
    recheck:
      !pending && downCandidates.length > 0
        ? { downCandidates, unreachableCandidate: false }
        : null,
  };
}

/** Baseline state from the first observation — no notifications */
function baseline(observation: ServerObservation): ServerMonitorState {
  if (!observation.reachable) return { apps: {}, unreachable: true };
  const apps: Record<string, AppHealth> = {};
  for (const [projectId, status] of Object.entries(observation.apps)) {
    const up = appIsUp(status);
    // Down at the first sight — its rise is not a recovery worth notifying
    if (up !== null) apps[projectId] = up ? "up" : "downAdopted";
  }
  return { apps, unreachable: false };
}

/**
 * Initial state from the cached statuses of past checks (app-status-cache.json).
 *
 * The cache stores AppStatus, not AppHealth, so a restart cannot tell "fell and
 * was already notified" from "seen down for the first time" — everything down
 * comes back as downAdopted. Deliberate asymmetry: a fall during downtime still
 * notifies (the cache holds the last observed "running"), but a recovery across
 * a restart does not. Not worth widening the on-disk format — at reopen the user
 * is already looking at the app list.
 */
export function stateFromCache(
  cached: Record<string, AppStatus> | undefined,
): ServerMonitorState | null {
  if (!cached) return null;
  return baseline({ reachable: true, apps: cached });
}
