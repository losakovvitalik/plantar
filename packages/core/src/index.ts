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

export interface DeployResult {
  target: string;
  fileCount: number;
  url: string;
  /** Порт Node.js-приложения; статические сайты его не используют */
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
  return config.type === "node"
    ? deployNode(conn, projectDir, config, log, options)
    : deployStatic(conn, projectDir, config, log, options);
}

async function deployStatic(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions,
): Promise<DeployResult> {
  log(`→ Собираю проект: ${config.buildCommand}`);
  try {
    await execAsync(config.buildCommand, { cwd: projectDir, maxBuffer: 50 * 1024 * 1024 });
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

async function deployNode(
  conn: SshConnection,
  projectDir: string,
  config: ProjectConfig,
  log: (line: string) => void,
  options: DeployOptions,
): Promise<DeployResult> {
  const target = `/var/www/${config.name}`;
  const staging = `/var/www/.${config.name}.uploading`;

  await run(conn, `rm -rf '${staging}'`, log);
  log("→ Загружаю файлы…");
  const fileCount = await conn.uploadDirectory(
    projectDir,
    staging,
    (file) => log(`  ↑ ${file}`),
    ["node_modules", ".git"],
  );
  log(`✓ Загружено файлов: ${fileCount}`);

  log(`→ Устанавливаю зависимости: ${config.packageManager} install`);
  await run(conn, `cd '${staging}' && ${config.packageManager} install`, log);

  const port = config.port ?? (await pickFreePort(conn));
  if (port !== config.port) log(`✓ Приложению назначен порт ${port}`);

  await run(conn, `rm -rf '${target}' && mv '${staging}' '${target}'`, log);
  log(`✓ Задеплоено файлов: ${fileCount} → ${target}`);

  // pm2 запускает первый токен команды как исполняемый файл; "node app.js" → скрипт app.js
  const startCommand = config.startCommand ?? `${config.packageManager} start`;
  const tokens = startCommand.trim().split(/\s+/);
  if (tokens[0] === "node") tokens.shift();
  const [script, ...scriptArgs] = tokens;
  if (!script) throw new Error("Команда запуска пуста — укажите startCommand в plantar.json.");

  const ecosystemPath = `${target}/plantar.pm2.config.cjs`;
  const ecosystem = `module.exports = {
  apps: [
    {
      name: ${JSON.stringify(config.name)},
      cwd: ${JSON.stringify(target)},
      script: ${JSON.stringify(script)},
      args: ${JSON.stringify(scriptArgs.join(" "))},
      env: { PORT: ${port}, NODE_ENV: "production" },
    },
  ],
};`;
  await run(conn, `cat > '${ecosystemPath}' <<'PLANTAR_EOF'\n${ecosystem}\nPLANTAR_EOF`, log);

  log(`→ Запускаю приложение через pm2: ${startCommand}`);
  await run(conn, `pm2 startOrRestart '${ecosystemPath}' --update-env`, log);
  // pm2 startup + save: приложение переживёт перезагрузку сервера
  await run(conn, `pm2 startup systemd -u "$(whoami)" --hp "$HOME"`, log);
  await run(conn, "pm2 save", log);

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
