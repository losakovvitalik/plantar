import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "../../../preload/index.d";
import { deployOnCommitProjectNames } from "./deploy-on-commit";

const project = (over: Partial<ProjectRecord> & Pick<ProjectRecord, "id" | "name">) => ({
  serverId: "s1",
  path: "/tmp/p",
  ...over,
});

describe("deployOnCommitProjectNames", () => {
  it("names only the server's projects marked as having deploy on commit", () => {
    // The warning in the trust dialog is chosen by the marker: a project with
    // it is named, a project of another server is not this server's problem
    const projects = [
      project({ id: "p1", name: "shop", deployOnCommit: true }),
      project({ id: "p2", name: "blog" }),
      project({ id: "p3", name: "landing", serverId: "s2", deployOnCommit: true }),
    ];

    expect(deployOnCommitProjectNames(projects, "s1")).toEqual(["shop"]);
  });

  it("chooses no warning when none of the server's projects has the marker", () => {
    // The sentence about setting deploy on commit up again used to be shown to
    // everyone; with the marker it is not shown when it is irrelevant
    const projects = [
      project({ id: "p1", name: "shop" }),
      project({ id: "p2", name: "blog", serverId: "s2", deployOnCommit: true }),
    ];

    expect(deployOnCommitProjectNames(projects, "s1")).toEqual([]);
  });

  it("treats records written before the marker existed as not set up", () => {
    // An old record carries no field at all — same as an explicit absence, so
    // old stores keep working without a migration or a forced re-setup
    const old = { id: "p1", serverId: "s1", name: "legacy", path: "/tmp/p" };

    expect(deployOnCommitProjectNames([old], "s1")).toEqual([]);
  });
});
