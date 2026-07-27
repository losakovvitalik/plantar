import type { TrafficStats } from "@plantar/core";
import type { ProjectRecord } from "@plantar/storage";

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
  if (project.external) return project.external.accessLogPath ?? null;
  return `/var/log/nginx/${name}.access.log`;
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
