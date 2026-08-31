import { describe, expect, it } from "vitest";
import type { ServerAppStatuses } from "../lib/use-app-statuses";
import { projectDotKind } from "./sidebar";

const OK: ServerAppStatuses = {
  kind: "ok",
  apps: { p1: "running" },
  checkedAt: "2026-09-01T10:00:00.000Z",
};

describe("projectDotKind", () => {
  it("shows a just-added project as checking while its check is pending", () => {
    // During a sweep an "ok" server keeps its previous entry, whose apps
    // snapshot predates the new project — the pending first check must show
    // as "checking", not "unknown" (#160)
    expect(projectDotKind(OK, "new-project", true)).toBe("checking");
  });

  it("keeps a known app status during a refresh", () => {
    expect(projectDotKind(OK, "p1", true)).toBe("running");
  });

  it("shows missing data as unknown once no check is pending", () => {
    expect(projectDotKind(OK, "new-project", false)).toBe("unknown");
  });

  it("does not pulse a non-ok server's projects on every sweep", () => {
    // A non-ok entry carries no per-project data, so its projects would
    // blink checking → unknown on every sweep if "refreshing" applied here
    const needsPassword: ServerAppStatuses = { kind: "needsPassword", apps: {} };
    expect(projectDotKind(needsPassword, "p1", true)).toBe("unknown");
  });

  it("shows a checking server's projects as checking", () => {
    expect(projectDotKind({ kind: "checking", apps: {} }, "p1", false)).toBe("checking");
  });

  it("shows a project of a server with no entry as checking", () => {
    expect(projectDotKind(undefined, "p1", false)).toBe("checking");
  });
});
