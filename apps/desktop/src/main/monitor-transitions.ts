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

/** Last confirmed state of one server */
export interface ServerMonitorState {
  /** projectId → whether the app is up (as of the last confirmed check) */
  apps: Record<string, boolean>;
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
 * notifies right away (the fall was already confirmed earlier). pending != null
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
  const apps: Record<string, boolean> = {};
  const downCandidates: string[] = [];

  for (const [projectId, status] of Object.entries(observation.apps)) {
    const wasUp = prev.apps[projectId];
    if (deploying.has(projectId)) {
      if (wasUp !== undefined) apps[projectId] = wasUp;
      continue;
    }
    const up = appIsUp(status);
    if (up === null) {
      if (wasUp !== undefined) apps[projectId] = wasUp;
      continue;
    }
    if (wasUp === undefined) {
      // A new app (or its first meaningful status) — adopt silently
      apps[projectId] = up;
      continue;
    }
    if (wasUp && !up) {
      if (pending) {
        if (pending.downCandidates.includes(projectId)) {
          // The fall is confirmed by the second check
          apps[projectId] = false;
          notifications.push({ kind: "appDown", projectId });
        } else {
          // Fell during the re-check window — waits for the next cycle
          apps[projectId] = true;
        }
      } else {
        // First detection — wait for confirmation, state stays "up" for now
        apps[projectId] = true;
        downCandidates.push(projectId);
      }
      continue;
    }
    if (!wasUp && up) {
      apps[projectId] = true;
      notifications.push({ kind: "appUp", projectId });
      continue;
    }
    apps[projectId] = up;
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
  const apps: Record<string, boolean> = {};
  for (const [projectId, status] of Object.entries(observation.apps)) {
    const up = appIsUp(status);
    if (up !== null) apps[projectId] = up;
  }
  return { apps, unreachable: false };
}

/** Initial state from the cached statuses of past checks (app-status-cache.json) */
export function stateFromCache(
  cached: Record<string, AppStatus> | undefined,
): ServerMonitorState | null {
  if (!cached) return null;
  return baseline({ reachable: true, apps: cached });
}
