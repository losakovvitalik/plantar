import type { ProjectRecord } from "../../../preload/index.d";

/**
 * Names of the server's projects that have deploy on commit set up — the ones
 * the trust-host-key dialog warns about: their repository on GitHub keeps its
 * own copy of the server's host key, so trusting a reinstalled server's new
 * key leaves their push-triggered deploys checking against the previous one.
 * Records written before the marker existed carry no marker and are left out —
 * nothing says they have deploy on commit, and the warning used to be shown to
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
