import type { ProjectRecord } from "../../../preload/index.d";

/**
 * Names of the server's projects that have deploy on commit set up — the ones
 * the trust-host-key dialog warns about: their repository on GitHub keeps its
 * own copy of the server's host key, so trusting a reinstalled server's new
 * key leaves their push-triggered deploys checking against the previous one.
 * A record written before the marker existed carries none, so the marker is
 * backfilled from the deploy workflow left in the repository before the names
 * are read here (`backfillDeployOnCommit`) — anything still without it has no
 * evidence of deploy on commit behind it, and the warning used to be shown to
 * everyone precisely because this could not be told apart.
 */
export function deployOnCommitProjectNames(
  projects: ProjectRecord[],
  serverId: string,
): string[] {
  return projects
    .filter((p) => p.serverId === serverId && p.deployOnCommit)
    .map((p) => p.name);
}
