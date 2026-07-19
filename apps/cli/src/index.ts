import path from "node:path";
import { Command } from "commander";
import { SshConnection } from "@plantar/ssh";
import { loadProjectConfig } from "@plantar/config";
import {
  deployProject,
  getServerInfo,
  getSiteLogs,
  setupServer,
} from "@plantar/core";
import {
  DeployLogWriter,
  appendHistory,
  readHistory,
  readSettings,
  saveServerLogSnapshot,
} from "@plantar/storage";
import { setLanguage } from "@plantar/i18n";
import { t } from "./messages";

// До объявления команд: commander берёт описания при создании программы
setLanguage(readSettings().language);

interface ConnectionOpts {
  host: string;
  port: string;
  user: string;
  password?: string;
  key?: string;
}

const program = new Command()
  .name("plantar")
  .description(t("programDescription"));

function withConnectionOptions(command: Command): Command {
  return command
    .requiredOption("--host <host>", t("optHost"))
    .option("--port <port>", t("optPort"), "22")
    .requiredOption("--user <user>", t("optUser"))
    .option("--password <password>", t("optPassword"))
    .option("--key <path>", t("optKey"));
}

async function connect(opts: ConnectionOpts): Promise<SshConnection> {
  if (!opts.password && !opts.key) {
    console.error(t("authRequired"));
    process.exit(1);
  }
  const conn = await SshConnection.connect({
    host: opts.host,
    port: Number(opts.port),
    username: opts.user,
    password: opts.password,
    privateKeyPath: opts.key,
  });
  console.log(t("connected", { user: opts.user, host: opts.host }));
  return conn;
}

withConnectionOptions(program.command("ls"))
  .description(t("cmdLs"))
  .option("--path <path>", t("optLsPath"), ".")
  .action(async (opts: ConnectionOpts & { path: string }) => {
    const conn = await connect(opts);
    try {
      const dirs = await conn.listDirectories(opts.path);
      console.log(`\n${t("lsHeader", { path: opts.path, count: dirs.length })}`);
      for (const name of dirs) {
        console.log(`  ${name}`);
      }
    } finally {
      conn.close();
      console.log(`\n${t("disconnected")}`);
    }
  });

withConnectionOptions(program.command("info"))
  .description(t("cmdInfo"))
  .action(async (opts: ConnectionOpts) => {
    const conn = await connect(opts);
    try {
      const info = await getServerInfo(conn);
      console.log(
        `\n${t("infoOs", {
          os: info.os.pretty,
          status: info.supported ? t("osSupported") : t("osUnsupported"),
        })}`,
      );
      console.log(t("infoCpu", { count: info.cpuCores }));
      console.log(t("infoRam", { mb: info.memoryTotalMb }));
      console.log(t("infoDisk", { gb: info.diskFreeRootGb }));
      console.log(t("infoTools"));
      for (const [tool, version] of Object.entries(info.tools)) {
        console.log(`  ${tool.padEnd(8)} ${version ?? t("notInstalled")}`);
      }
    } finally {
      conn.close();
      console.log(`\n${t("disconnected")}`);
    }
  });

withConnectionOptions(program.command("setup"))
  .description(t("cmdSetup"))
  .action(async (opts: ConnectionOpts) => {
    const conn = await connect(opts);
    try {
      const results = await setupServer(conn, (line) => console.log(line));
      const installed = results.filter((r) => r.status === "installed");
      console.log(
        `\n${t("setupDone", {
          installed: installed.length,
          present: results.length - installed.length,
        })}`,
      );
    } finally {
      conn.close();
      console.log(`\n${t("disconnected")}`);
    }
  });

withConnectionOptions(program.command("deploy"))
  .description(t("cmdDeploy"))
  .option("--project <dir>", t("optProjectDir"), ".")
  .action(async (opts: ConnectionOpts & { project: string }) => {
    const projectDir = path.resolve(opts.project);
    const config = loadProjectConfig(projectDir);
    console.log(t("deployProjectHeader", { name: config.name, dir: projectDir }));

    const logWriter = new DeployLogWriter(config.name);
    const log = (line: string) => {
      console.log(line);
      logWriter.write(line);
    };
    const startedAt = new Date().toISOString();

    const conn = await connect(opts);
    try {
      const result = await deployProject(conn, projectDir, config, log);
      appendHistory({
        project: config.name,
        host: opts.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "success",
        url: result.url,
        logFile: logWriter.file,
      });
      console.log(`\n${t("deployLogFile", { file: logWriter.file })}`);
    } catch (err) {
      const message = (err as Error).message;
      logWriter.write(`\n${t("deployLogError")}: ${message}`);
      appendHistory({
        project: config.name,
        host: opts.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        error: message,
        logFile: logWriter.file,
      });
      console.error(`\n${t("deployLogFile", { file: logWriter.file })}`);
      throw err;
    } finally {
      conn.close();
      console.log(`\n${t("disconnected")}`);
    }
  });

withConnectionOptions(program.command("logs"))
  .description(t("cmdLogs"))
  .option("--project <dir>", t("optProjectDir"), ".")
  .option("--lines <n>", t("optLines"), "50")
  .action(async (opts: ConnectionOpts & { project: string; lines: string }) => {
    const config = loadProjectConfig(path.resolve(opts.project));
    const conn = await connect(opts);
    try {
      const logs = await getSiteLogs(conn, config.name, Number(opts.lines));
      console.log(`\n=== access (${config.name}) ===`);
      console.log(logs.access || t("logsEmpty"));
      console.log(`\n=== error (${config.name}) ===`);
      console.log(logs.error || t("logsEmpty"));

      const accessFile = saveServerLogSnapshot(config.name, "access", logs.access);
      saveServerLogSnapshot(config.name, "error", logs.error);
      console.log(`\n${t("logsSnapshots", { dir: path.dirname(accessFile) })}`);
    } finally {
      conn.close();
      console.log(`\n${t("disconnected")}`);
    }
  });

program
  .command("history")
  .description(t("cmdHistory"))
  .option("--project <name>", t("optHistoryProject"))
  .action((opts: { project?: string }) => {
    const history = readHistory().filter(
      (r) => !opts.project || r.project === opts.project,
    );
    if (history.length === 0) {
      console.log(t("historyEmpty"));
      return;
    }
    for (const r of history) {
      const when = r.startedAt.replace("T", " ").slice(0, 19);
      const outcome = r.status === "success" ? `✓ ${r.url ?? ""}` : `✗ ${r.error?.split("\n")[0] ?? ""}`;
      console.log(`${when}  ${r.project} → ${r.host}  ${outcome}`);
      console.log(t("historyLogFile", { file: r.logFile }));
    }
  });

program.parseAsync().catch((err: Error) => {
  console.error(t("errorPrefix"), err.message);
  process.exit(1);
});
