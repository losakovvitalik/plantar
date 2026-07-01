import type { SshConnection } from "@plantar/ssh";

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
const TOOL_VERSION_COMMANDS: Record<string, string> = {
  node: "node --version 2>&1",
  pnpm: "pnpm --version 2>&1",
  pm2: "pm2 --version 2>&1",
  nginx: "nginx -v 2>&1",
  certbot: "certbot --version 2>&1",
};

function parseOsRelease(text: string, field: string): string {
  const match = text.match(new RegExp(`^${field}=(.*)$`, "m"));
  return match ? match[1].replace(/^"|"$/g, "") : "";
}

export async function getServerInfo(conn: SshConnection): Promise<ServerInfo> {
  const osRelease = (await conn.exec("cat /etc/os-release")).stdout;
  const id = parseOsRelease(osRelease, "ID");
  const version = parseOsRelease(osRelease, "VERSION_ID");
  const pretty = parseOsRelease(osRelease, "PRETTY_NAME");

  const cpuCores = parseInt((await conn.exec("nproc")).stdout.trim(), 10);

  const memKb = parseInt(
    (await conn.exec("grep MemTotal /proc/meminfo")).stdout.replace(/\D/g, ""),
    10,
  );

  const diskFreeKb = parseInt(
    (await conn.exec("df -k / | tail -1 | awk '{print $4}'")).stdout.trim(),
    10,
  );

  const tools: Record<string, string | null> = {};
  for (const [tool, versionCommand] of Object.entries(TOOL_VERSION_COMMANDS)) {
    const result = await conn.exec(versionCommand);
    tools[tool] = result.code === 0 ? result.stdout.trim() || result.stderr.trim() : null;
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
