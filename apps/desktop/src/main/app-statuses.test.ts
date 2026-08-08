import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProjectRecord,
  type ServerRecord,
  writeProjects,
  writeServers,
} from "@plantar/storage";
import { collectServerAppStatuses } from "./app-statuses";

// Every plantar.json read lands here, keyed by the project directory
const { loads } = vi.hoisted(() => ({ loads: [] as string[] }));

vi.mock("@plantar/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plantar/config")>();
  return {
    ...actual,
    loadProjectConfig: (dir: string) => {
      loads.push(dir);
      return {
        name: `cfg-${dir.split("/").pop()}`,
        type: "static",
        runtime: "node",
        packageManager: "npm",
        buildCommand: "npm run build",
        buildDir: "dist",
      };
    },
  };
});

// The sweep runs without SSH: the pooled connection is a stub, the server
// reports no pm2 processes and no sites are checked (the history is empty)
vi.mock("./connections", () => ({
  withServer: (
    _server: unknown,
    _password: unknown,
    fn: (conn: unknown) => Promise<unknown>,
  ) => fn({}),
}));
vi.mock("@plantar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plantar/core")>();
  return {
    ...actual,
    pm2ProcessStatuses: async () => new Map<string, string>(),
    checkSitesRespond: async () => [],
  };
});

let tmpHome: string;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-app-statuses-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));
  loads.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("collectServerAppStatuses", () => {
  it("one sweep reads each project's plantar.json at most once for the history lookups", async () => {
    const server: ServerRecord = {
      id: "s1",
      name: "s1",
      host: "203.0.113.1",
      port: 22,
      user: "root",
      auth: "key",
    };
    writeServers([server]);
    const projects: ProjectRecord[] = ["a", "b", "c"].map((id) => ({
      id,
      serverId: "s1",
      name: id,
      path: `/projects/${id}`,
    }));
    writeProjects(projects);

    const { apps } = await collectServerAppStatuses(server);

    expect(apps).toEqual({ a: "static", b: "static", c: "static" });
    // Per project: one read resolves its site/type, one fills the sweep's
    // shared name map; the three static history lookups add none — before the
    // lookup each of them re-read every same-host project's config
    const counts = new Map<string, number>();
    for (const dir of loads) counts.set(dir, (counts.get(dir) ?? 0) + 1);
    for (const p of projects) {
      expect(counts.get(p.path), p.path).toBeLessThanOrEqual(2);
    }
  });
});
