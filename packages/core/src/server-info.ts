import type { SshConnection } from "@plantar/ssh";
import { t } from "./messages";
import { MAX_ERROR_OUTPUT_CHARS } from "./output-limits";
import { run } from "./process-checks";

export interface ServerInfo {
  os: {
    id: string;
    version: string;
    pretty: string;
  };
  /** Ubuntu 22.04 / 24.04 — единственные поддерживаемые ОС в MVP */
  supported: boolean;
  cpuCores: number;
  memoryTotalMb: number;
  diskFreeRootGb: number;
  /** Версия инструмента или null, если не установлен */
  tools: Record<string, string | null>;
}

const SUPPORTED_UBUNTU_VERSIONS = ["22.04", "24.04"];

// nginx пишет версию в stderr, поэтому везде 2>&1
export const TOOL_VERSION_COMMANDS: Record<string, string> = {
  node: "node --version 2>&1",
  pnpm: "pnpm --version 2>&1",
  pm2: "pm2 --version 2>&1",
  nginx: "nginx -v 2>&1",
  certbot: "certbot --version 2>&1",
  // Для python-ботов; python3 есть в Ubuntu из коробки, а venv — нет,
  // поэтому проверяем ensurepip: он ставится вместе с python3-venv
  python: "python3 -m ensurepip --version >/dev/null 2>&1 && python3 --version 2>&1",
};

function parseOsRelease(text: string, field: string): string {
  const match = text.match(new RegExp(`^${field}=(.*)$`, "m"));
  return match ? match[1].replace(/^"|"$/g, "") : "";
}

// Markers separating the checks combined into one shell command. All ~10
// checks used to be separate execs (sequential round-trips); running them in
// parallel instead is unsafe — each parallel exec opens its own SSH channel
// and typical sshd MaxSessions=10 answers the excess with "Channel open
// failure" — so they are joined into a single exec.
const SERVER_INFO_SECTION = "__PLANTAR_SECTION__";
const SERVER_INFO_EXIT = "__PLANTAR_EXIT__";
// Parse-side contract of the exit marker: the exit code digits follow it directly
const SERVER_INFO_EXIT_RE = new RegExp(`${SERVER_INFO_EXIT}(\\d+)`);

/** All server checks of getServerInfo as one shell command (one SSH round-trip) */
export function serverInfoCommand(): string {
  const sections: Array<[string, string]> = [
    ["os-release", "cat /etc/os-release"],
    ["nproc", "nproc"],
    ["meminfo", "grep MemTotal /proc/meminfo"],
    ["disk", "df -k / | tail -1 | awk '{print $4}'"],
    ...Object.entries(TOOL_VERSION_COMMANDS).map(
      ([tool, command]): [string, string] => [`tool:${tool}`, command],
    ),
  ];
  return sections
    .map(
      ([name, command]) =>
        `echo '${SERVER_INFO_SECTION}${name}'; ${command}; echo "${SERVER_INFO_EXIT}$?"`,
    )
    .join("; ");
}

/** Splits the combined serverInfoCommand output back into per-check results */
export function parseServerInfoOutput(
  stdout: string,
): Map<string, { output: string; code: number }> {
  const sections = new Map<string, { output: string; code: number }>();
  for (const part of stdout.split(SERVER_INFO_SECTION).slice(1)) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    const name = part.slice(0, newline).trim();
    const body = part.slice(newline + 1);
    // The exit marker may share a line with output that lacks a trailing newline
    const exit = body.match(SERVER_INFO_EXIT_RE);
    sections.set(name, {
      output: (exit ? body.slice(0, exit.index) : body).trim(),
      code: exit ? Number(exit[1]) : -1,
    });
  }
  return sections;
}

export async function getServerInfo(conn: SshConnection): Promise<ServerInfo> {
  const command = serverInfoCommand();
  const combined = await conn.exec(command);
  // The combined command always exits 0 on its own (it ends with an echo), so
  // a non-zero/-1 code means the channel dropped mid-run. Throw instead of
  // parsing partial output into garbage (NaN cores, all tools null) — the
  // previous sequential execs surfaced a dropped connection as an error too.
  if (combined.code !== 0) {
    const output = [combined.stdout, combined.stderr].filter(Boolean).join("\n").slice(-MAX_ERROR_OUTPUT_CHARS);
    throw new Error(t("commandFailed", { code: combined.code, command, stderr: output }));
  }
  const sections = parseServerInfoOutput(combined.stdout);
  const output = (name: string) => sections.get(name)?.output ?? "";

  const osRelease = output("os-release");
  const id = parseOsRelease(osRelease, "ID");
  const version = parseOsRelease(osRelease, "VERSION_ID");
  const pretty = parseOsRelease(osRelease, "PRETTY_NAME");

  const cpuCores = parseInt(output("nproc"), 10);
  const memKb = parseInt(output("meminfo").replace(/\D/g, ""), 10);
  const diskFreeKb = parseInt(output("disk"), 10);

  const tools: Record<string, string | null> = {};
  for (const tool of Object.keys(TOOL_VERSION_COMMANDS)) {
    const section = sections.get(`tool:${tool}`);
    // Version commands redirect stderr to stdout, so the output holds both
    tools[tool] = section && section.code === 0 ? section.output : null;
  }

  return {
    os: { id, version, pretty },
    supported: id === "ubuntu" && SUPPORTED_UBUNTU_VERSIONS.includes(version),
    cpuCores,
    memoryTotalMb: Math.round(memKb / 1024),
    diskFreeRootGb: Math.round((diskFreeKb / 1024 / 1024) * 10) / 10,
    tools,
  };
}

export interface SetupStepResult {
  tool: string;
  status: "present" | "installed";
  version: string | null;
}

const INSTALL_COMMANDS: Record<string, string[]> = {
  node: [
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
    "DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs",
  ],
  pnpm: ["npm install -g pnpm"],
  pm2: ["npm install -g pm2"],
  nginx: ["DEBIAN_FRONTEND=noninteractive apt-get install -y nginx"],
  certbot: [
    "DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx",
  ],
  python: [
    "DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv python3-pip",
  ],
};

export async function setupServer(
  conn: SshConnection,
  log: (line: string) => void = () => {},
): Promise<SetupStepResult[]> {
  log(t("checkingServer"));
  const info = await getServerInfo(conn);
  if (!info.supported) {
    throw new Error(
      t("osUnsupported", {
        os: info.os.pretty,
        versions: SUPPORTED_UBUNTU_VERSIONS.join(" / "),
      }),
    );
  }

  const results: SetupStepResult[] = [];
  let aptUpdated = false;

  for (const [tool, installCommands] of Object.entries(INSTALL_COMMANDS)) {
    if (info.tools[tool] !== null) {
      log(t("toolPresent", { tool, version: info.tools[tool] }));
      results.push({ tool, status: "present", version: info.tools[tool] });
      continue;
    }

    log(t("toolInstalling", { tool }));
    if (!aptUpdated) {
      await run(conn, "apt-get update", log);
      aptUpdated = true;
    }
    for (const command of installCommands) {
      await run(conn, command, log);
    }

    const version = await conn.exec(TOOL_VERSION_COMMANDS[tool]);
    if (version.code !== 0) {
      throw new Error(t("toolMissingAfterInstall", { tool }));
    }
    log(t("toolInstalled", { tool, version: version.stdout.trim() }));
    results.push({ tool, status: "installed", version: version.stdout.trim() });
  }

  return results;
}
