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
  hostKey?: string;
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
    .option("--key <path>", t("optKey"))
    .option("--host-key <fingerprint>", t("optHostKey"));
}

/**
 * Brings a pinned host key to the canonical "SHA256:<digest>" form. Accepts the
 * canonical form itself, a whole `ssh-keygen -lf` line (the fingerprint field is
 * picked out of it) and the bare digest without the prefix. Returns null for
 * anything else: a mistyped value must be reported as a bad argument, not as a
 * server that changed its key.
 */
function parseHostKey(value: string): string | null {
  // A SHA-256 digest in base64 without padding is exactly 43 characters; the
  // boundaries keep a longer base64 blob (a whole public key) from matching
  const match = value.trim().match(/(?:^|\s)(?:SHA256:)?([A-Za-z0-9+/]{43})=*(?=\s|$)/i);
  return match ? `SHA256:${match[1]}` : null;
}

async function connect(opts: ConnectionOpts): Promise<SshConnection> {
  // A password in --password is visible in `ps` and in the shell history,
  // so the environment variable is the preferred way to pass it
  const password = opts.password ?? process.env.PLANTAR_PASSWORD;
  if (!password && !opts.key) {
    console.error(t("authRequired"));
    process.exit(1);
  }
  // The CLI keeps no server records, so the key to compare against comes from
  // the run itself. Without it the key is only reported, not checked — the run
  // prints the fingerprint to pin so the next one (a CI deploy) can verify.
  // An empty value counts as unset: an unfilled matrix entry or a missing
  // secret expands to "", and reporting that as a mistyped fingerprint would
  // blame the user for a value they never typed
  const pinnedHostKey = opts.hostKey || process.env.PLANTAR_HOST_KEY || undefined;
  const expectedHostKey =
    pinnedHostKey === undefined ? undefined : parseHostKey(pinnedHostKey);
  if (pinnedHostKey !== undefined && !expectedHostKey) {
    // Stop on the value itself: comparing it as-is would fail as a key mismatch,
    // which in CI reads as a compromised server rather than as a typo
    console.error(t("hostKeyInvalid", { value: pinnedHostKey }));
    process.exit(1);
  }
  // The type of the pinned key, when whoever pinned it knows one — the app
  // writes it next to the fingerprint when it sets up deploy-on-commit. Asking
  // for that type first is what keeps a server that has since gained a key of
  // another type answering with the pinned one; without it the ssh library's
  // own order decides, and the pinned key stops being the one presented.
  // Nothing is ruled out: the verifier below still has the final say
  const pinnedHostKeyType = process.env.PLANTAR_HOST_KEY_TYPE || undefined;
  // ssh2 runs the verifier again on every key exchange, and a long deploy
  // rekeys mid-run: the check stays on each of them, the notice is printed once
  // — repeated, it reads as if a second connection were being made
  let warnedUnchecked = false;
  const conn = await SshConnection.connect({
    host: opts.host,
    port: Number(opts.port),
    username: opts.user,
    password,
    privateKeyPath: opts.key,
    knownHostKeyTypes: pinnedHostKeyType ? [pinnedHostKeyType] : undefined,
    // The pinned value is a bare fingerprint, so the key type is not part of
    // the comparison: a CI run is given one key to expect and stops on anything
    // else, which is what an explicit --host-key is for
    verifyHostKey: ({ fingerprint }) => {
      if (expectedHostKey) return expectedHostKey === fingerprint;
      if (!warnedUnchecked) {
        warnedUnchecked = true;
        console.warn(t("hostKeyUnchecked", { fingerprint }));
      }
      return true;
    },
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
        urlCheck: result.urlCheck,
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
      // The run is over — release the log file's descriptor
      logWriter.close();
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
      console.log(`\n${t("logsAccessHeader", { name: config.name })}`);
      console.log(logs.access || t("logsEmpty"));
      console.log(`\n${t("logsErrorHeader", { name: config.name })}`);
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
      // A success whose post-deploy check did not confirm the site gets "!"
      // instead of "✓" — the record is honest, the marker must be too
      const unconfirmed =
        r.status === "success" &&
        (r.urlCheck === "no-answer" || r.urlCheck === "plain-http");
      const outcome =
        r.status === "success"
          ? `${unconfirmed ? "!" : "✓"} ${r.url ?? ""}`
          : `✗ ${r.error?.split("\n")[0] ?? ""}`;
      console.log(`${when}  ${r.project} → ${r.host}  ${outcome}`);
      if (unconfirmed) {
        console.log(t(r.urlCheck === "no-answer" ? "historyNoAnswer" : "historyPlainHttp"));
      }
      console.log(t("historyLogFile", { file: r.logFile }));
    }
  });

program.parseAsync().catch((err: Error) => {
  console.error(t("errorPrefix"), err.message);
  process.exit(1);
});
