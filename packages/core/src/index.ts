import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import type { SshConnection } from "@plantar/ssh";
import type { ProjectConfig } from "@plantar/config";

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
  // Для python-ботов; python3 есть в Ubuntu из коробки, а venv — нет,
  // поэтому проверяем ensurepip: он ставится вместе с python3-venv
  python: "python3 -m ensurepip --version >/dev/null 2>&1 && python3 --version 2>&1",
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

async function run(
  conn: SshConnection,
  command: string,
  log: (line: string) => void,
): Promise<void> {
  log(`$ ${command}`);
  const result = await conn.exec(command);
  if (result.code !== 0) {
    throw new Error(
      `Команда завершилась с кодом ${result.code}: ${command}\n${result.stderr.slice(-2000)}`,
    );
  }
}

export async function setupServer(
  conn: SshConnection,
  log: (line: string) => void = () => {},
): Promise<SetupStepResult[]> {
  log("Проверяю сервер…");
  const info = await getServerInfo(conn);
  if (!info.supported) {
    throw new Error(
      `ОС «${info.os.pretty}» не поддерживается. Нужна Ubuntu ${SUPPORTED_UBUNTU_VERSIONS.join(" или ")}.`,
    );
  }

  const results: SetupStepResult[] = [];
  let aptUpdated = false;

  for (const [tool, installCommands] of Object.entries(INSTALL_COMMANDS)) {
    if (info.tools[tool] !== null) {
      log(`✓ ${tool} уже установлен (${info.tools[tool]})`);
      results.push({ tool, status: "present", version: info.tools[tool] });
      continue;
    }

    log(`→ Устанавливаю ${tool}…`);
    if (!aptUpdated) {
      await run(conn, "apt-get update", log);
      aptUpdated = true;
    }
    for (const command of installCommands) {
      await run(conn, command, log);
    }

    const version = await conn.exec(TOOL_VERSION_COMMANDS[tool]);
    if (version.code !== 0) {
      throw new Error(`${tool}: установка прошла, но инструмент не найден в PATH.`);
    }
    log(`✓ ${tool} установлен (${version.stdout.trim()})`);
    results.push({ tool, status: "installed", version: version.stdout.trim() });
  }

  return results;
}

/** Env-файлы проектов живут на сервере вне папок релизов — деплой их не затирает */
const ENV_STORE_DIR = "/var/www/.plantar/env";
const envStorePath = (name: string) => `${ENV_STORE_DIR}/${name}.env`;

/** Имена локальных env-файлов, которые не должны попадать на сервер при загрузке кода */
export const ENV_FILE_RE = /^\.env[\w.-]*$/;

/** Содержимое env-файла проекта на сервере; отсутствие файла — пустая строка */
export async function readProjectEnv(conn: SshConnection, name: string): Promise<string> {
  const result = await conn.exec(`cat '${envStorePath(name)}' 2>/dev/null`);
  return result.code === 0 ? result.stdout : "";
}

export async function writeProjectEnv(
  conn: SshConnection,
  name: string,
  content: string,
): Promise<void> {
  // base64 избавляет от экранирования произвольных значений; 600 — файл с секретами
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const file = envStorePath(name);
  const result = await conn.exec(
    `mkdir -p '${ENV_STORE_DIR}' && chmod 700 '${ENV_STORE_DIR}' && ` +
      `echo '${encoded}' | base64 -d > '${file}' && chmod 600 '${file}'`,
  );
  if (result.code !== 0) {
    throw new Error(`Не удалось сохранить переменные на сервере:\n${result.stderr.slice(-2000)}`);
  }
}

/** KEY=VALUE-строки env-файла; комментарии и мусор пропускаются, кавычки вокруг значения снимаются */
function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    vars[match[1]] = value;
  }
  return vars;
}

export interface SiteLogs {
  access: string;
  error: string;
}

export async function getSiteLogs(
  conn: SshConnection,
  siteName: string,
  lines = 50,
): Promise<SiteLogs> {
  const read = async (kind: "access" | "error") => {
    const result = await conn.exec(
      `tail -n ${lines} '/var/log/nginx/${siteName}.${kind}.log' 2>/dev/null`,
    );
    return result.stdout.trimEnd();
  };
  return { access: await read("access"), error: await read("error") };
}

/** Останавливает проект и удаляет его следы с сервера: pm2-процесс, файлы, конфиг nginx */
export async function removeDeployedProject(
  conn: SshConnection,
  name: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  // У статических сайтов pm2-процесса нет — отсутствие не ошибка
  log(`→ Останавливаю pm2-процесс «${name}»…`);
  const deleted = await conn.exec(`pm2 delete '${name}'`);
  if (deleted.code === 0) {
    await run(conn, "pm2 save --force", log);
    log("✓ Процесс остановлен и убран из автозапуска");
  } else {
    log("  pm2-процесс не найден — пропускаю");
  }

  log("→ Удаляю файлы проекта…");
  await run(
    conn,
    `rm -rf '/var/www/${name}' '/var/www/.${name}.uploading' '${envStorePath(name)}'`,
    log,
  );

  // Конфиг nginx есть только у сайтов; у ботов его нет
  const conf = await conn.exec(`test -e '/etc/nginx/sites-available/${name}.conf'`);
  if (conf.code === 0) {
    log("→ Удаляю конфиг nginx…");
    await run(
      conn,
      `rm -f '/etc/nginx/sites-enabled/${name}.conf' '/etc/nginx/sites-available/${name}.conf'`,
      log,
    );
    await run(conn, "systemctl reload nginx", log);
  }

  log(`✓ Проект «${name}» удалён с сервера`);
}

export interface DeployResult {
  target: string;
  fileCount: number;
  /** Адрес сайта; у ботов его нет */
  url?: string;
  /** Порт Node.js-приложения; статические сайты и боты его не используют */
  port?: number;
}

async function configureNginx(
  conn: SshConnection,
  config: ProjectConfig,
  log: (line: string) => void,
  appPort?: number,
): Promise<void> {
  // Без домена сайт становится default_server — отвечает по IP.
  const listen = config.domain ? "80" : "80 default_server";
  const serverName = config.domain ?? "_";
  const confPath = `/etc/nginx/sites-available/${config.name}.conf`;

  // Для node-приложения nginx проксирует запросы на порт, для статики — раздаёт файлы
  const location = appPort
    ? `location / {
        proxy_pass http://127.0.0.1:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`
    : `location / {
        try_files $uri $uri/ /index.html;
    }`;

  const rootLines = appPort
    ? ""
    : `
    root /var/www/${config.name};
    index index.html;
`;

  const conf = `server {
    listen ${listen};
    server_name ${serverName};
${rootLines}
    access_log /var/log/nginx/${config.name}.access.log;
    error_log /var/log/nginx/${config.name}.error.log;

    ${location}
}`;

  log(`→ Настраиваю nginx (${confPath})…`);
  await run(conn, `cat > '${confPath}' <<'PLANTAR_EOF'\n${conf}\nPLANTAR_EOF`, log);

  if (!config.domain) {
    // Стандартный сайт-заглушка nginx тоже default_server — убираем, чтобы не конфликтовал
    await run(conn, "rm -f /etc/nginx/sites-enabled/default", log);
  }
  await run(
    conn,
    `ln -sf '../sites-available/${config.name}.conf' '/etc/nginx/sites-enabled/${config.name}.conf'`,
    log,
  );

  const check = await conn.exec("nginx -t");
  if (check.code !== 0) {
    throw new Error(`Конфигурация nginx не прошла проверку:\n${check.stderr}`);
  }
  await run(conn, "systemctl reload nginx", log);
  log("✓ nginx настроен и перезагружен");
}

async function setupSsl(
  conn: SshConnection,
  domain: string,
  log: (line: string) => void,
  email?: string,
): Promise<void> {
  log(`→ Настраиваю HTTPS для ${domain}…`);
  // С email Let's Encrypt предупредит о проблемах с продлением сертификата
  const account = email ? `--email '${email}' --no-eff-email` : "--register-unsafely-without-email";
  // --keep-until-expiring: при повторном деплое сертификат не перевыпускается.
  // certbot сам дописывает SSL-блок в наш nginx-конфиг и настраивает редирект с http.
  await run(
    conn,
    `certbot --nginx -d '${domain}' --non-interactive --agree-tos ${account} --redirect --keep-until-expiring`,
    log,
  );
  log(`✓ HTTPS настроен, сертификат будет продлеваться автоматически`);
}

export interface DeployOptions {
  /** Email для регистрации в Let's Encrypt */
  letsEncryptEmail?: string;
}

export async function deployProject(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void = () => {},
  options: DeployOptions = {},
): Promise<DeployResult> {
  switch (config.type) {
    case "node":
      return deployNode(conn, projectDir, config, log, options);
    case "bot":
      return deployBot(conn, projectDir, config, log);
    default:
      return deployStatic(conn, projectDir, config, log, options);
  }
}

async function deployStatic(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions,
): Promise<DeployResult> {
  // Переменные проекта хранятся на сервере; при сборке они приоритетнее локальных .env
  const envVars = parseEnv(await readProjectEnv(conn, config.name));
  const varCount = Object.keys(envVars).length;
  if (varCount > 0) log(`✓ Переменные окружения с сервера: ${varCount} шт.`);

  log(`→ Собираю проект: ${config.buildCommand}`);
  try {
    await execAsync(config.buildCommand, {
      cwd: projectDir,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, ...envVars },
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const output = [e.stdout, e.stderr]
      .filter(Boolean)
      .join("\n")
      .slice(-3000);
    throw new Error(`Сборка не удалась (${config.buildCommand}):\n${output}`);
  }

  const localDist = path.join(projectDir, config.buildDir);
  if (!existsSync(localDist)) {
    throw new Error(
      `После сборки не найдена папка «${config.buildDir}» в ${projectDir}. Проверь buildDir в plantar.json.`,
    );
  }

  const target = `/var/www/${config.name}`;
  const staging = `/var/www/.${config.name}.uploading`;

  await run(conn, `rm -rf '${staging}'`, log);
  log(`→ Загружаю файлы…`);
  const fileCount = await conn.uploadDirectory(localDist, staging, (file) =>
    log(`  ↑ ${file}`),
  );
  await run(conn, `rm -rf '${target}' && mv '${staging}' '${target}'`, log);
  log(`✓ Задеплоено файлов: ${fileCount} → ${target}`);

  await configureNginx(conn, config, log);

  let url: string;
  if (config.domain) {
    await setupSsl(conn, config.domain, log, options.letsEncryptEmail);
    url = `https://${config.domain}/`;
  } else {
    url = `http://${conn.host}/`;
  }
  log(`✓ Сайт доступен: ${url}`);
  return { target, fileCount, url };
}

const APP_PORT_RANGE = { from: 3001, to: 3999 };

/** Свободный порт: не занят слушающим процессом и не выдан другому сайту в nginx */
async function pickFreePort(conn: SshConnection): Promise<number> {
  const used = new Set<number>();

  const listening = await conn.exec("ss -tlnH");
  for (const match of listening.stdout.matchAll(/:(\d+)\s/g)) {
    used.add(Number(match[1]));
  }

  // Порты упавших приложений не слушаются, но закреплены в конфигах nginx
  const assigned = await conn.exec(
    "grep -rhoE 'proxy_pass http://127\\.0\\.0\\.1:[0-9]+' /etc/nginx/sites-available/ 2>/dev/null",
  );
  for (const match of assigned.stdout.matchAll(/:(\d+)/g)) {
    used.add(Number(match[1]));
  }

  for (let port = APP_PORT_RANGE.from; port <= APP_PORT_RANGE.to; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error(
    `Не нашлось свободного порта в диапазоне ${APP_PORT_RANGE.from}–${APP_PORT_RANGE.to}.`,
  );
}

/** Ждёт, пока приложение начнёт отвечать по HTTP; при неудаче — ошибка с логами pm2 */
async function waitForApp(
  conn: SshConnection,
  name: string,
  port: number,
  log: (line: string) => void,
): Promise<void> {
  log(`→ Проверяю, что приложение отвечает на порту ${port}…`);
  const check = await conn.exec(
    `for i in $(seq 1 30); do ` +
      `code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:${port}/); ` +
      `if [ "$code" != "000" ]; then exit 0; fi; sleep 1; done; exit 1`,
  );
  if (check.code !== 0) {
    const logs = await conn.exec(`pm2 logs '${name}' --nostream --lines 30 2>&1`);
    throw new Error(
      `Приложение не отвечает на порту ${port}. Последние строки логов:\n${logs.stdout.slice(-3000)}`,
    );
  }
  log("✓ Приложение отвечает");
}

/** Общее для node и bot: загрузка проекта, установка зависимостей, подмена целевой папки */
async function uploadApp(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
): Promise<{ target: string; fileCount: number }> {
  const python = config.runtime === "python";
  if (python && !existsSync(path.join(projectDir, "requirements.txt"))) {
    throw new Error(`Не найден requirements.txt в ${projectDir} — он нужен python-боту.`);
  }

  const target = `/var/www/${config.name}`;
  const staging = `/var/www/.${config.name}.uploading`;

  await run(conn, `rm -rf '${staging}'`, log);
  log("→ Загружаю файлы…");
  // Локальные .env-файлы не загружаются: переменные проекта хранятся на сервере
  const fileCount = await conn.uploadDirectory(
    projectDir,
    staging,
    (file) => log(`  ↑ ${file}`),
    python ? [".venv", "__pycache__", ".git", ENV_FILE_RE] : ["node_modules", ".git", ENV_FILE_RE],
  );
  log(`✓ Загружено файлов: ${fileCount}`);

  if (python) {
    log("→ Создаю виртуальное окружение и ставлю зависимости: pip install -r requirements.txt");
    await run(
      conn,
      `cd '${staging}' && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`,
      log,
    );
  } else {
    log(`→ Устанавливаю зависимости: ${config.packageManager} install`);
    await run(conn, `cd '${staging}' && ${config.packageManager} install`, log);
  }

  await run(conn, `rm -rf '${target}' && mv '${staging}' '${target}'`, log);
  log(`✓ Задеплоено файлов: ${fileCount} → ${target}`);

  // Env-файл проекта хранится вне папки релиза — кладём копию рядом с кодом,
  // чтобы приложение нашло его как обычный .env
  const envFile = envStorePath(config.name);
  const hasEnv = await conn.exec(`test -f '${envFile}'`);
  if (hasEnv.code === 0) {
    log("→ Подставляю переменные окружения с сервера…");
    await run(conn, `cp '${envFile}' '${target}/.env' && chmod 600 '${target}/.env'`, log);
  }
  return { target, fileCount };
}

/** Пишет pm2-конфиг и запускает процесс; настраивает автозапуск после перезагрузки сервера */
async function startWithPm2(
  conn: SshConnection,
  target: string,
  config: ProjectConfig,
  env: Record<string, string | number>,
  log: (line: string) => void,
): Promise<void> {
  const python = config.runtime === "python";
  // pm2 запускает первый токен команды как исполняемый файл; интерпретатор
  // ("node app.js", "python bot.py") отрезаем — pm2 подставит свой
  const startCommand =
    config.startCommand ?? (python ? "" : `${config.packageManager} start`);
  const tokens = startCommand.trim().split(/\s+/);
  if (["node", "python", "python3"].includes(tokens[0])) tokens.shift();
  const [script, ...scriptArgs] = tokens;
  if (!script) throw new Error("Команда запуска пуста — укажите startCommand в plantar.json.");

  // Python-процесс запускается интерпретатором из venv, созданного при деплое
  const interpreterLine = python
    ? `\n      interpreter: ${JSON.stringify(`${target}/.venv/bin/python`)},`
    : "";
  const ecosystemPath = `${target}/plantar.pm2.config.cjs`;
  const ecosystem = `module.exports = {
  apps: [
    {
      name: ${JSON.stringify(config.name)},
      cwd: ${JSON.stringify(target)},
      script: ${JSON.stringify(script)},
      args: ${JSON.stringify(scriptArgs.join(" "))},${interpreterLine}
      env: ${JSON.stringify(env)},
    },
  ],
};`;
  await run(conn, `cat > '${ecosystemPath}' <<'PLANTAR_EOF'\n${ecosystem}\nPLANTAR_EOF`, log);

  log(`→ Запускаю через pm2: ${startCommand}`);
  await run(conn, `pm2 startOrRestart '${ecosystemPath}' --update-env`, log);
  // pm2 startup + save: процесс переживёт перезагрузку сервера
  await run(conn, `pm2 startup systemd -u "$(whoami)" --hp "$HOME"`, log);
  await run(conn, "pm2 save", log);
}

async function deployNode(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions,
): Promise<DeployResult> {
  const { target, fileCount } = await uploadApp(conn, projectDir, config, log);

  const port = config.port ?? (await pickFreePort(conn));
  if (port !== config.port) log(`✓ Приложению назначен порт ${port}`);

  await startWithPm2(conn, target, config, { PORT: port, NODE_ENV: "production" }, log);

  await waitForApp(conn, config.name, port, log);

  await configureNginx(conn, config, log, port);

  let url: string;
  if (config.domain) {
    await setupSsl(conn, config.domain, log, options.letsEncryptEmail);
    url = `https://${config.domain}/`;
  } else {
    url = `http://${conn.host}/`;
  }
  log(`✓ Приложение доступно: ${url}`);
  return { target, fileCount, url, port };
}

interface Pm2Process {
  name: string;
  pm2_env: { status: string; pm_uptime: number };
}

/** Бот не слушает порт, поэтому вместо HTTP-проверки убеждаемся,
 *  что pm2-процесс живёт несколько секунд и не перезапускается */
async function waitForStableProcess(
  conn: SshConnection,
  name: string,
  log: (line: string) => void,
): Promise<void> {
  log("→ Проверяю, что процесс работает…");
  const result = await conn.exec(`sleep 5; echo "NOW:$(date +%s%3N)"; pm2 jlist 2>/dev/null`);
  const now = Number(result.stdout.match(/^NOW:(\d+)$/m)?.[1]);

  let processes: Pm2Process[] = [];
  const jsonStart = result.stdout.indexOf("[");
  if (jsonStart !== -1) {
    try {
      processes = JSON.parse(result.stdout.slice(jsonStart)) as Pm2Process[];
    } catch {
      /* нечитаемый вывод pm2 — обработается как «процесс не найден» */
    }
  }

  const app = processes.find((p) => p.name === name);
  const stable =
    app && app.pm2_env.status === "online" && now - app.pm2_env.pm_uptime >= 4000;
  if (!stable) {
    const logs = await conn.exec(`pm2 logs '${name}' --nostream --lines 30 2>&1`);
    throw new Error(
      `Процесс «${name}» не запустился или падает сразу после старта. Последние строки логов:\n${logs.stdout.slice(-3000)}`,
    );
  }
  log("✓ Процесс работает стабильно");
}

async function deployBot(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
): Promise<DeployResult> {
  const { target, fileCount } = await uploadApp(conn, projectDir, config, log);

  await startWithPm2(conn, target, config, { NODE_ENV: "production" }, log);

  await waitForStableProcess(conn, config.name, log);

  log("✓ Бот запущен. pm2 перезапустит его после падения и после перезагрузки сервера.");
  return { target, fileCount };
}
