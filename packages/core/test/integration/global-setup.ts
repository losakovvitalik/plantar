import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

/**
 * Starts the disposable Docker test server (see fixture/Dockerfile) before
 * the integration run and removes it afterwards. The container is bound to
 * 127.0.0.1 on random host ports; tests receive them via inject().
 */

declare module "vitest" {
  interface ProvidedContext {
    /** Host port mapped to the container's sshd (22) */
    sshPort: number;
    /** Host port mapped to the container's nginx (80) */
    httpPort: number;
  }
}

export const SSH_USER = "root";
export const SSH_PASSWORD = "plantar-test";

const IMAGE = "plantar-core-integration";
const CONTAINER = `plantar-core-it-${Date.now()}`;
const FIXTURE_DIR = fileURLToPath(new URL("./fixture", import.meta.url));

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function mappedPort(containerPort: string): number {
  const output = docker("port", CONTAINER, containerPort);
  const match = output.match(/:(\d+)\s*$/m);
  if (!match) {
    throw new Error(`Could not resolve the host port for ${containerPort}: ${output}`);
  }
  return Number(match[1]);
}

/** Waits until sshd inside the container answers with its SSH banner */
function waitForSsh(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      let settled = false;
      const socket = createConnection({ host: "127.0.0.1", port });
      const retry = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error("sshd in the test container did not come up in time"));
        } else {
          setTimeout(attempt, 500);
        }
      };
      socket.setTimeout(2000, retry);
      socket.once("error", retry);
      socket.once("data", (chunk: Buffer) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (chunk.toString().startsWith("SSH-")) resolve();
        else retry();
      });
    };
    attempt();
  });
}

export default async function setup(project: TestProject): Promise<() => void> {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "Docker is not available. The integration tests need a running Docker daemon; " +
        "start Docker and retry, or run only the unit tests with `pnpm test`.",
    );
  }

  // Docker's layer cache makes rebuilds after the first one near-instant
  execFileSync("docker", ["build", "-t", IMAGE, FIXTURE_DIR], { stdio: "inherit" });

  docker(
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-p",
    "127.0.0.1:0:22",
    "-p",
    "127.0.0.1:0:80",
    IMAGE,
  );

  try {
    const sshPort = mappedPort("22/tcp");
    const httpPort = mappedPort("80/tcp");
    await waitForSsh(sshPort);
    project.provide("sshPort", sshPort);
    project.provide("httpPort", httpPort);
  } catch (err) {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    throw err;
  }

  return () => {
    // No volumes are mounted, so removing the container erases all state
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  };
}
