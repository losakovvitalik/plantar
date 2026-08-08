import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord, ServerRecord } from "@plantar/storage";
import { currentNamesById, historyIdentity, projectHistory } from "./project-history";

// Every plantar.json read lands here; config names get a cfg- prefix so the
// tests can tell a config-resolved name from the record-name fallback
const { loads } = vi.hoisted(() => ({ loads: [] as string[] }));

vi.mock("@plantar/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plantar/config")>();
  return {
    ...actual,
    loadProjectConfig: (dir: string) => {
      loads.push(dir);
      const id = dir.split("/").pop() ?? dir;
      if (id.startsWith("broken")) throw new Error("unreadable");
      return {
        name: `cfg-${id}`,
        type: "static",
        runtime: "node",
        packageManager: "npm",
        buildCommand: "npm run build",
        buildDir: "dist",
      };
    },
  };
});

const server = (id: string, host: string): ServerRecord => ({
  id,
  name: id,
  host,
  port: 22,
  user: "root",
  auth: "key",
});

const project = (
  id: string,
  serverId: string,
  over: Partial<ProjectRecord> = {},
): ProjectRecord => ({ id, serverId, name: id, path: `/projects/${id}`, ...over });

beforeEach(() => {
  loads.length = 0;
});

describe("currentNamesById", () => {
  it("resolves each project's config exactly once, keeping the record-name fallback", () => {
    const names = currentNamesById([project("a", "s1"), project("broken-b", "s1")]);
    expect(names.get("a")).toBe("cfg-a");
    // Unreadable plantar.json falls back to the record name, like currentName
    expect(names.get("broken-b")).toBe("broken-b");
    expect(loads).toEqual(["/projects/a", "/projects/broken-b"]);
  });
});

describe("historyIdentity", () => {
  const servers = [server("s1", "203.0.113.1")];

  it("uses precomputed names without re-reading configs, keeping taken-name semantics", () => {
    const a = project("a", "s1", { previousNames: ["cfg-b", "legacy"] });
    const b = project("b", "s1");
    const projects = [a, b];
    const names = currentNamesById(projects);
    loads.length = 0;
    const identity = historyIdentity(a, { servers, projects, names });
    // "cfg-b" is the name b goes by today — its records belong to b
    expect(identity.names).toEqual(["cfg-a", "a", "legacy"]);
    expect(loads).toEqual([]);
  });

  it("reads configs itself when no precomputed names are passed", () => {
    const a = project("a", "s1", { previousNames: ["cfg-b", "legacy"] });
    const b = project("b", "s1");
    const identity = historyIdentity(a, { servers, projects: [a, b] });
    expect(identity.names).toEqual(["cfg-a", "a", "legacy"]);
    expect(loads).toContain("/projects/a");
    expect(loads).toContain("/projects/b");
  });
});

describe("projectHistory sweep", () => {
  it("shared stores with precomputed names read each project's config at most once", () => {
    const servers = [server("s1", "203.0.113.1")];
    const projects = [project("a", "s1"), project("b", "s1"), project("c", "s1")];
    const stores = { servers, projects, history: [], names: currentNamesById(projects) };
    // Building the lookup is the single read per project…
    expect(loads).toEqual(["/projects/a", "/projects/b", "/projects/c"]);
    loads.length = 0;
    for (const p of projects) projectHistory(p, stores);
    // …and the history lookups of every static project add none
    expect(loads).toEqual([]);
  });
});
