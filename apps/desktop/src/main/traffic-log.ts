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
