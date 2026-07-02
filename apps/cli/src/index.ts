import { Command } from "commander";
import { SshConnection } from "@plantar/ssh";
import { getServerInfo, setupServer } from "@plantar/core";

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

program.parseAsync().catch((err: Error) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
