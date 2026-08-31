import { describe, expect, it } from "vitest";
import { sweepEntry, type ServerAppStatuses } from "./use-app-statuses";

const OK: ServerAppStatuses = {
  kind: "ok",
  apps: { p1: "running" },
  checkedAt: "2026-09-01T10:00:00.000Z",
};

describe("sweepEntry", () => {
  it("keeps the last known status while the re-check runs", () => {
    // Adding or removing a server re-checks the whole list; the other
    // servers' dots must not blink into "checking" while that happens (#160)
    expect(sweepEntry(OK, false)).toBe(OK);
  });

  it("keeps an unresolved check showing as one still under way", () => {
    // A slow or hanging check must not be mistaken for a fresh result
    const checking: ServerAppStatuses = { kind: "checking", apps: {} };
    expect(sweepEntry(checking, false)).toBe(checking);
  });

  it("starts a server with no previous status as checking", () => {
    expect(sweepEntry(undefined, false)).toEqual({ kind: "checking", apps: {} });
  });

  it("keeps the identity warning over the last known status", () => {
    // Last check's data stays, as the interface promises for non-ok kinds
    expect(sweepEntry(OK, true)).toEqual({ ...OK, kind: "identityChanged" });
  });

  it("shows the identity warning even with no previous status", () => {
    expect(sweepEntry(undefined, true)).toEqual({ kind: "identityChanged", apps: {} });
  });
});
