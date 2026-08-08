import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type DeployRecord,
  type ProjectRecord,
  type ServerRecord,
  dataDir,
  writeProjects,
  writeServers,
} from "@plantar/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectServerAppStatuses } from "./app-statuses";

// Every plantar.json the sweep reads, in call order. The count is what these
// tests are about: a project's config must be read once per sweep, however
// many static sites walk the history.
const { configReads } = vi.hoisted(() => ({ configReads: [] as string[] }));

vi.mock("@plantar/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plantar/config")>();
  return {
    ...actual,
    loadProjectConfig: (projectDir: string) => {
      configReads.push(projectDir);
      return actual.loadProjectConfig(projectDir);
    },
  };
});

// The server side of the sweep is not under test: one connection, an empty pm2
// table (these projects are static sites) and sites that answer
vi.mock("./connections", () => ({
  withServer: <T>(_server: unknown, _password: unknown, fn: (conn: unknown) => Promise<T>) =>
    fn({}),
}));
vi.mock("@plantar/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plantar/core")>()),
  pm2ProcessStatuses: async () => new Map<string, string>(),
  checkSitesRespond: async (_conn: unknown, urls: string[]) => urls.map(() => true),
}));

const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "key",
};

let tmpHome: string;
let projectsRoot: string;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-app-statuses-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));
  projectsRoot = path.join(tmpHome, "projects");
  configReads.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

/** A static project of the server with its own folder; `withConfig: false`
 *  leaves the folder without a plantar.json, as when the code moved away */
function makeProject(
  id: string,
  name: string,
  extra: { previousNames?: string[]; withConfig?: boolean } = {},
): ProjectRecord {
  const dir = path.join(projectsRoot, id);
  mkdirSync(dir, { recursive: true });
  if (extra.withConfig !== false) {
    writeFileSync(
      path.join(dir, "plantar.json"),
      JSON.stringify({ name, type: "static", buildDir: "build" }),
    );
  }
  return {
    id,
    serverId: server.id,
    name,
    path: dir,
    ...(extra.previousNames ? { previousNames: extra.previousNames } : {}),
  };
}

/** A successful deploy under a name, without a project id — as the CLI and
 *  the pre-id versions wrote them, so it is matched by name + host */
function successRecord(project: string): DeployRecord {
  return {
    project,
    host: server.host,
    startedAt: "2026-08-01T10:00:00.000Z",
    finishedAt: "2026-08-01T10:01:00.000Z",
    status: "success",
    logFile: `deploy-${project}.log`,
  };
}

function seed(projects: ProjectRecord[], history: DeployRecord[]): void {
  writeServers([server]);
  writeProjects(projects);
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(path.join(dataDir(), "history.json"), JSON.stringify(history));
}

describe("collectServerAppStatuses", () => {
  it("reads each project's plantar.json once, whatever the number of static sites", async () => {
    const alpha = makeProject("p-alpha", "alpha", { previousNames: ["legacy"] });
    const legacy = makeProject("p-legacy", "legacy");
    const beta = makeProject("p-beta", "beta");
    seed([alpha, legacy, beta], [successRecord("legacy"), successRecord("beta")]);

    const { apps } = await collectServerAppStatuses(server);

    // The name "legacy" belongs to the project that goes by it today, so the
    // record under that name is not alpha's — alpha has never deployed
    expect(apps).toEqual({
      "p-alpha": "static",
      "p-legacy": "running",
      "p-beta": "running",
    });
    // Four reads per static site before the sweep-wide lookup — one for its own
    // status plus three in historyIdentity (its own name and the other two) —
    // so twelve across the three sites, three now
    expect([...configReads].sort()).toEqual([alpha.path, beta.path, legacy.path].sort());
  });

  it("keeps the record-name fallback for a project without a plantar.json", async () => {
    const alpha = makeProject("p-alpha", "alpha", { previousNames: ["legacy"] });
    const legacy = makeProject("p-legacy", "legacy", { withConfig: false });
    seed([alpha, legacy], [successRecord("legacy")]);

    const { apps } = await collectServerAppStatuses(server);

    // The unreadable config falls back to the name of the record, so "legacy"
    // still counts as taken and its deploy stays out of alpha's history
    expect(apps["p-alpha"]).toBe("static");
    // No config, no type — the app is looked up in the pm2 table instead
    expect(apps["p-legacy"]).toBe("stopped");
    expect([...configReads].sort()).toEqual([alpha.path, legacy.path].sort());
  });
});
