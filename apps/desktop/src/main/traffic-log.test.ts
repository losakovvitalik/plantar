import type { ProjectRecord } from "@plantar/storage";
import { describe, expect, it } from "vitest";
import { trafficLogPath } from "./traffic-log";

const managed: ProjectRecord = {
  id: "p1",
  serverId: "s1",
  name: "shop",
  path: "/home/user/shop",
};

const external = (accessLogPath?: string): ProjectRecord => ({
  id: "p2",
  serverId: "s1",
  name: "academicals",
  path: "",
  external: {
    pm2Name: "academicals",
    appDir: "/var/www/academicals",
    accessLogPath,
    config: { name: "academicals", type: "next" },
  },
});

describe("trafficLogPath", () => {
  it("managed project: log path follows Plantar's naming convention", () => {
    expect(trafficLogPath(managed, "shop")).toBe("/var/log/nginx/shop.access.log");
  });

  it("imported app with a discovered access_log: reads exactly that file", () => {
    expect(trafficLogPath(external("/var/log/nginx/academicals-access.log"), "academicals")).toBe(
      "/var/log/nginx/academicals-access.log",
    );
  });

  it("imported app without a discovered access_log: no log of its own", () => {
    // The naming convention must not be applied to a foreign config — that file
    // never exists, and the card would tell the user to deploy for nothing
    expect(trafficLogPath(external(), "academicals")).toBeNull();
  });

  it("imported app with `access_log off`: the switch is not a path", () => {
    expect(trafficLogPath(external("off"), "academicals")).toBeNull();
  });
});
