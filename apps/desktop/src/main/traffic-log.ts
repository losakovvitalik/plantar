import type { TrafficStats } from "@plantar/core";
import type { ProjectRecord } from "@plantar/storage";
import { appAccessLogPath } from "@plantar/core/paths";

/**
 * Access log to read app visits from, or null when the app has none of its own.
 *
 * A managed project gets its access_log from Plantar's own nginx template, so
 * the path follows Plantar's naming convention. An imported app keeps the nginx
 * config it came with: when that config has no access_log directive of its own,
 * requests land in the server-wide log mixed with every other site there. The
 * naming convention says nothing about such an app, so guessing a path by it
 * would only point at a file that never exists.
 */
export function trafficLogPath(project: ProjectRecord, name: string): string | null {
  if (project.external) {
    // Discovery takes the first access_log of the server block, nested location
    // blocks included, and `access_log off;` is a switch rather than a path — so
    // the literal "off" can arrive here and means the app has no log of its own
    const discovered = project.external.accessLogPath;
    return discovered && discovered !== "off" ? discovered : null;
  }
  return appAccessLogPath(name);
}

/**
 * A log that could not be read is a shared-log state for an imported app.
 *
 * Careful mode writes no nginx config, so nothing a deploy does would create a
 * log of its own — whether the discovered path went stale, the file was removed
 * without an nginx reload, or it never was a path at all.
 */
export function markSharedLog(project: ProjectRecord, stats: TrafficStats): TrafficStats {
  return project.external && stats.logMissing ? { ...stats, sharedLog: true } : stats;
}

/** Visits summary of an app that writes into the server-wide log */
export const SHARED_LOG_TRAFFIC: TrafficStats = {
  logMissing: true,
  sharedLog: true,
  totalHits: 0,
  totalVisitors: 0,
  byDay: [],
  byHour: [],
  statusCodes: [],
  topPaths: [],
};
