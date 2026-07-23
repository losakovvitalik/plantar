import { Notification, net, powerMonitor } from "electron";
import {
  type AppStatusEntry,
  type ServerRecord,
  readAppStatusCache,
  readProjects,
  readServers,
  readSettings,
} from "@plantar/storage";
import { activeDeployRuns } from "./deploy-runs";
import { t } from "./i18n";
import {
  type MonitorNotification,
  type PendingCheck,
  type ServerMonitorState,
  type ServerObservation,
  detectTransitions,
  stateFromCache,
} from "./monitor-transitions";
import { isConnected } from "./ssh-pool";

/**
 * Background monitor: every MONITOR_INTERVAL_MS sweeps the servers reachable
 * without a password prompt and notifies about apps going down and coming
 * back. A fall is confirmed by a re-check MONITOR_CONFIRM_DELAY_MS later
 * before notifying — pm2 restarts and blips must not wake the user.
 *
 * Only servers with key auth are monitored (plus password servers while their
 * pooled connection is still alive) — passwords are never stored, and the
 * monitor must never prompt. The UI explains this for password servers.
 */

/** How often the background sweep runs; a deliberate constant, not a setting.
 *  The interval is named in the UI and the docs — when changing it, update
 *  settings.notifyAppDownHint in renderer i18n (ru/en) and docs/features.md */
export const MONITOR_INTERVAL_MS = 5 * 60 * 1000;
/** Pause before the confirmation re-check of a suspected fall */
export const MONITOR_CONFIRM_DELAY_MS = 30 * 1000;
/** Delay before the first sweep after waking from sleep — let the network settle */
const RESUME_GRACE_MS = 60 * 1000;
/** How old a cached snapshot may be to serve as the "last known status" */
const CACHE_BASELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface AppMonitorDeps {
  /** One-round-trip statuses of all server apps (same path as the sidebar) */
  collectStatuses(server: ServerRecord): Promise<AppStatusEntry>;
  /** Brings the window up (creating it if needed); with a projectId — opens it */
  openFromBackground(projectId?: string): void;
}

let deps: AppMonitorDeps | null = null;
/** serverId → last confirmed state */
const states = new Map<string, ServerMonitorState>();
let cycleTimer: NodeJS.Timeout | null = null;
const recheckTimers = new Map<string, NodeJS.Timeout>();
/** Servers being checked right now — a second check would race on the state */
const inFlight = new Set<string>();
let suspended = false;
let stopped = false;

export function startAppMonitor(d: AppMonitorDeps): void {
  deps = d;
  // Statuses of the previous session are the "last known" baseline — an app
  // that fell while Plantar was not running still gets its notification.
  // A stale snapshot is not a status: an app stopped by the user weeks ago
  // would be reported as a fall, so old entries start from scratch instead
  for (const [serverId, entry] of Object.entries(readAppStatusCache())) {
    const age = Date.now() - new Date(entry.checkedAt).getTime();
    if (age > CACHE_BASELINE_MAX_AGE_MS) continue;
    const state = stateFromCache(entry.apps);
    if (state) states.set(serverId, state);
  }
  // A sweep firing mid-wake would see a dead network and cry wolf — pause the
  // cycle for sleep and give the network a grace period after resume
  powerMonitor.on("suspend", () => {
    suspended = true;
    clearTimers();
  });
  powerMonitor.on("resume", () => {
    suspended = false;
    schedule(RESUME_GRACE_MS);
  });
  schedule(MONITOR_INTERVAL_MS);
}

export function stopAppMonitor(): void {
  stopped = true;
  clearTimers();
}

/** Forgets a removed server: without this its pending re-check would fire in
 *  half a minute, reconnect to a server that is no longer in the list and can
 *  report it as unreachable */
export function forgetServer(serverId: string): void {
  const timer = recheckTimers.get(serverId);
  if (timer) clearTimeout(timer);
  recheckTimers.delete(serverId);
  states.delete(serverId);
}

function clearTimers(): void {
  if (cycleTimer) clearTimeout(cycleTimer);
  cycleTimer = null;
  // Pending confirmations die with the timers: after sleep they would compare
  // against a pre-sleep snapshot and confirm phantom falls
  for (const timer of recheckTimers.values()) clearTimeout(timer);
  recheckTimers.clear();
}

function schedule(delay: number): void {
  if (stopped || suspended) return;
  if (cycleTimer) clearTimeout(cycleTimer);
  cycleTimer = setTimeout(() => {
    void runCycle()
      .catch((err) => console.error("[monitor] sweep failed:", err))
      .finally(() => schedule(MONITOR_INTERVAL_MS));
  }, delay);
}

async function runCycle(): Promise<void> {
  if (!readSettings().notifyOnAppDown) return;
  // No local network — nothing can be checked and nothing should be blamed
  // on the servers; stay silent until connectivity is back
  if (!net.isOnline()) return;
  const servers = readServers();
  for (const id of [...states.keys()]) {
    if (!servers.some((s) => s.id === id)) states.delete(id);
  }
  const eligible = servers.filter(
    (server) => server.auth === "key" || isConnected(server.id),
  );
  await Promise.all(eligible.map((server) => checkServer(server, null)));
}

async function checkServer(
  server: ServerRecord,
  pending: PendingCheck | null,
): Promise<void> {
  if (!deps || stopped || suspended) return;
  if (!readSettings().notifyOnAppDown) return;
  // A password server is only checkable while its pooled connection lives;
  // once the pool drops it, skipping silently is correct — needing a password
  // is not a server incident (also guards the confirmation re-check)
  if (server.auth === "password" && !isConnected(server.id)) return;
  // A check of this server is still running (a sweep that hung on a connection
  // broken by sleep, for instance) — two of them would overwrite each other's
  // state depending on which finishes last, losing a confirmed fall
  if (inFlight.has(server.id)) {
    // Don't drop a pending confirmation when its timer fires mid-check: re-arm
    // it so the fall is confirmed on the next slot, not a full cycle later
    if (pending) scheduleRecheck(server, pending);
    return;
  }
  inFlight.add(server.id);

  try {
    let observation: ServerObservation;
    try {
      observation = { reachable: true, apps: (await deps.collectStatuses(server)).apps };
    } catch (err) {
      // The user's own connectivity vanishing is not a server incident
      if (!net.isOnline()) return;
      // The pooled connection died mid-flight and reconnecting needs a password
      if (server.auth === "password" && !isConnected(server.id)) return;
      // Logged before blaming the server: a bug in the collector looks exactly
      // like an unreachable server otherwise
      console.error(`[monitor] collect failed on ${server.name}:`, err);
      observation = { reachable: false };
    }

    const deploying = new Set(activeDeployRuns().map((run) => run.projectId));
    const result = detectTransitions(
      states.get(server.id) ?? null,
      observation,
      pending,
      deploying,
    );
    states.set(server.id, result.state);

    for (const notification of result.notifications) notify(server, notification);

    if (result.recheck) {
      console.log(
        `[monitor] suspected on ${server.name}: ` +
          (result.recheck.unreachableCandidate
            ? "server unreachable"
            : `apps down [${result.recheck.downCandidates.join(", ")}]`) +
          ", re-checking",
      );
      scheduleRecheck(server, result.recheck);
    }
  } finally {
    inFlight.delete(server.id);
  }
}

/** Arms the confirmation re-check of a suspected fall, replacing any pending one */
function scheduleRecheck(server: ServerRecord, pending: PendingCheck): void {
  const existing = recheckTimers.get(server.id);
  if (existing) clearTimeout(existing);
  recheckTimers.set(
    server.id,
    setTimeout(() => {
      recheckTimers.delete(server.id);
      void checkServer(server, pending).catch((err) =>
        console.error("[monitor] re-check failed:", err),
      );
    }, MONITOR_CONFIRM_DELAY_MS),
  );
}

function notify(server: ServerRecord, notification: MonitorNotification): void {
  const project = notification.projectId
    ? readProjects().find((p) => p.id === notification.projectId)
    : undefined;
  console.log(
    `[monitor] ${notification.kind} on ${server.name}` +
      (project ? `: ${project.name}` : ""),
  );
  if (!Notification.isSupported()) return;
  if (notification.projectId && !project) return;

  const params = { name: project?.name ?? "", server: server.name };
  const shown = new Notification(
    notification.kind === "appDown"
      ? { title: t("notifyAppDownTitle"), body: t("notifyAppDownBody", params) }
      : notification.kind === "appUp"
        ? { title: t("notifyAppUpTitle"), body: t("notifyAppUpBody", params) }
        : {
            title: t("notifyServerUnreachableTitle"),
            body: t("notifyServerUnreachableBody", { name: server.name }),
          },
  );
  const projectId = notification.projectId;
  shown.on("click", () => deps?.openFromBackground(projectId));
  shown.show();
}
