import { readFileSync } from "node:fs";
import { Command } from "commander";
import { Client } from "ssh2";

const program = new Command();

program
  .name("plantar")
  .description("Подключиться к серверу по SSH и вывести список директорий")
  .requiredOption("--host <host>", "адрес сервера")
  .option("--port <port>", "SSH-порт", "22")
  .requiredOption("--user <user>", "имя пользователя")
  .option("--password <password>", "пароль (если без ключа)")
  .option("--key <path>", "путь к приватному ключу")
  .option("--path <path>", "директория для листинга", ".")
  .parse();

const opts = program.opts<{
  host: string;
  port: string;
  user: string;
  password?: string;
  key?: string;
  path: string;
}>();

if (!opts.password && !opts.key) {
  console.error("Нужно указать --password или --key для аутентификации.");
  process.exit(1);
}

const conn = new Client();

conn
  .on("ready", () => {
    console.log(`Подключено к ${opts.user}@${opts.host}.`);
    conn.sftp((err, sftp) => {
      if (err) {
        console.error("Ошибка SFTP:", err.message);
        conn.end();
        process.exitCode = 1;
        return;
      }
      sftp.readdir(opts.path, (err, list) => {
        if (err) {
          console.error(`Не удалось прочитать «${opts.path}»:`, err.message);
          conn.end();
          process.exitCode = 1;
          return;
        }
        const dirs = list
          .filter((entry) => entry.attrs.isDirectory())
          .map((entry) => entry.filename)
          .sort();

        console.log(`\nДиректории в «${opts.path}» (${dirs.length}):`);
        for (const name of dirs) {
          console.log(`  ${name}`);
        }
        conn.end();
      });
    });
  })
  .on("error", (err) => {
    console.error("Ошибка подключения:", err.message);
    process.exitCode = 1;
  })
  .on("close", () => {
    console.log("\nОтключено.");
  })
  .connect({
    host: opts.host,
    port: Number(opts.port),
    username: opts.user,
    password: opts.password,
    privateKey: opts.key ? readFileSync(opts.key) : undefined,
  });
