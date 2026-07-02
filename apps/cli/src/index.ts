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
  saveServerLogSnapshot,
} from "@plantar/storage";

interface ConnectionOpts {
  host: string;
  port: string;
  user: string;
  password?: string;
  key?: string;
}

const program = new Command()
  .name("plantar")
  .description("Деплой React-приложений на Ubuntu-серверы");

function withConnectionOptions(command: Command): Command {
  return command
    .requiredOption("--host <host>", "адрес сервера")
    .option("--port <port>", "SSH-порт", "22")
    .requiredOption("--user <user>", "имя пользователя")
    .option("--password <password>", "пароль (если без ключа)")
    .option("--key <path>", "путь к приватному ключу");
}

async function connect(opts: ConnectionOpts): Promise<SshConnection> {
  if (!opts.password && !opts.key) {
    console.error("Нужно указать --password или --key для аутентификации.");
    process.exit(1);
  }
  const conn = await SshConnection.connect({
    host: opts.host,
    port: Number(opts.port),
    username: opts.user,
    password: opts.password,
    privateKeyPath: opts.key,
  });
  console.log(`Подключено к ${opts.user}@${opts.host}.`);
  return conn;
}

withConnectionOptions(program.command("ls"))
  .description("вывести список директорий на сервере")
  .option("--path <path>", "директория для листинга", ".")
  .action(async (opts: ConnectionOpts & { path: string }) => {
    const conn = await connect(opts);
    try {
      const dirs = await conn.listDirectories(opts.path);
      console.log(`\nДиректории в «${opts.path}» (${dirs.length}):`);
      for (const name of dirs) {
        console.log(`  ${name}`);
      }
    } finally {
      conn.close();
      console.log("\nОтключено.");
    }
  });

withConnectionOptions(program.command("info"))
  .description("показать ОС, ресурсы и установленные инструменты")
  .action(async (opts: ConnectionOpts) => {
    const conn = await connect(opts);
    try {
      const info = await getServerInfo(conn);
      console.log(
        `\nОС: ${info.os.pretty} — ${info.supported ? "поддерживается" : "НЕ поддерживается (нужна Ubuntu 22.04 или 24.04)"}`,
      );
      console.log(`CPU: ${info.cpuCores} ядер`);
      console.log(`RAM: ${info.memoryTotalMb} МБ`);
      console.log(`Диск (свободно на /): ${info.diskFreeRootGb} ГБ`);
      console.log("Инструменты:");
      for (const [tool, version] of Object.entries(info.tools)) {
        console.log(`  ${tool.padEnd(8)} ${version ?? "не установлен"}`);
      }
    } finally {
      conn.close();
      console.log("\nОтключено.");
    }
  });

withConnectionOptions(program.command("setup"))
  .description("установить Node.js, pnpm, pm2, nginx и certbot")
  .action(async (opts: ConnectionOpts) => {
    const conn = await connect(opts);
    try {
      const results = await setupServer(conn, (line) => console.log(line));
      const installed = results.filter((r) => r.status === "installed");
      console.log(
        `\nГотово: установлено ${installed.length}, уже было ${results.length - installed.length}.`,
      );
    } finally {
      conn.close();
      console.log("\nОтключено.");
    }
  });

withConnectionOptions(program.command("deploy"))
  .description("собрать проект и загрузить на сервер")
  .option("--project <dir>", "папка проекта с plantar.json", ".")
  .action(async (opts: ConnectionOpts & { project: string }) => {
    const projectDir = path.resolve(opts.project);
    const config = loadProjectConfig(projectDir);
    console.log(`Проект «${config.name}» (${projectDir})`);

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
      console.log(`\nЛог деплоя: ${logWriter.file}`);
    } catch (err) {
      const message = (err as Error).message;
      logWriter.write(`\nОШИБКА: ${message}`);
      appendHistory({
        project: config.name,
        host: opts.host,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "error",
        error: message,
        logFile: logWriter.file,
      });
      console.error(`\nЛог деплоя: ${logWriter.file}`);
      throw err;
    } finally {
      conn.close();
      console.log("\nОтключено.");
    }
  });

withConnectionOptions(program.command("logs"))
  .description("показать логи nginx по сайту (access и error)")
  .option("--project <dir>", "папка проекта с plantar.json", ".")
  .option("--lines <n>", "сколько последних строк показать", "50")
  .action(async (opts: ConnectionOpts & { project: string; lines: string }) => {
    const config = loadProjectConfig(path.resolve(opts.project));
    const conn = await connect(opts);
    try {
      const logs = await getSiteLogs(conn, config.name, Number(opts.lines));
      console.log(`\n=== access (${config.name}) ===`);
      console.log(logs.access || "(пусто)");
      console.log(`\n=== error (${config.name}) ===`);
      console.log(logs.error || "(пусто)");

      const accessFile = saveServerLogSnapshot(config.name, "access", logs.access);
      saveServerLogSnapshot(config.name, "error", logs.error);
      console.log(`\nСнапшоты сохранены локально: ${path.dirname(accessFile)}`);
    } finally {
      conn.close();
      console.log("\nОтключено.");
    }
  });

program
  .command("history")
  .description("история деплоев (локальная, без подключения к серверу)")
  .option("--project <name>", "фильтр по имени проекта")
  .action((opts: { project?: string }) => {
    const history = readHistory().filter(
      (r) => !opts.project || r.project === opts.project,
    );
    if (history.length === 0) {
      console.log("История пуста.");
      return;
    }
    for (const r of history) {
      const when = r.startedAt.replace("T", " ").slice(0, 19);
      const outcome = r.status === "success" ? `✓ ${r.url ?? ""}` : `✗ ${r.error?.split("\n")[0] ?? ""}`;
      console.log(`${when}  ${r.project} → ${r.host}  ${outcome}`);
      console.log(`  лог: ${r.logFile}`);
    }
  });

program.parseAsync().catch((err: Error) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
