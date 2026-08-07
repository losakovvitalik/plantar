import { type SshConnection, shellQuote } from "@plantar/ssh";
import type { ProjectConfig } from "@plantar/config";
import { findDomainConflicts, parseNginxSites } from "./discover";
import { t } from "./messages";
import { appAccessLogPath, appErrorLogPath } from "./paths";
import { run } from "./process-checks";
import { TOOL_VERSION_COMMANDS } from "./server-info";

export async function configureNginx(
  conn: SshConnection,
  config: ProjectConfig,
  log: (line: string) => void,
  appPort?: number,
): Promise<void> {
  // Чужой конфиг с тем же доменом перехватывал бы запросы (включая 443-блок
  // с сертификатом) — отключаем его до записи своего конфига и до certbot
  if (config.domain) {
    const dump = await conn.exec("nginx -T 2>/dev/null");
    const conflicts =
      dump.code === 0
        ? findDomainConflicts(parseNginxSites(dump.stdout), config.domain, config.name)
        : [];
    for (const file of new Set(conflicts.map((site) => site.file))) {
      log(t("domainConflict", { domain: config.domain, file }));
      await disableForeignNginxConf(conn, file, config.name, log);
    }
  }

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
    root /var/www/${config.name}/current;
    index index.html;
`;

  const conf = `server {
    listen ${listen};
    server_name ${serverName};
${rootLines}
    access_log ${appAccessLogPath(config.name)};
    error_log ${appErrorLogPath(config.name)};

    ${location}
}`;

  log(t("configuringNginx", { path: confPath }));
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
    throw new Error(t("nginxCheckFailed", { stderr: check.stderr }));
  }
  await run(conn, "systemctl reload nginx", log);
  log(t("nginxConfigured"));
}

/** certbot account args; the email is user input, so it must be shell-quoted —
 *  an apostrophe is valid in an email address and would break the command */
export function certbotAccountArgs(email?: string): string {
  return email
    ? `--email ${shellQuote(email)} --no-eff-email`
    : "--register-unsafely-without-email";
}

export async function setupSsl(
  conn: SshConnection,
  domain: string,
  log: (line: string) => void,
  email?: string,
): Promise<void> {
  log(t("configuringHttps", { domain }));
  // С email Let's Encrypt предупредит о проблемах с продлением сертификата
  const account = certbotAccountArgs(email);
  // --keep-until-expiring: при повторном деплое сертификат не перевыпускается.
  // certbot сам дописывает SSL-блок в наш nginx-конфиг и настраивает редирект с http.
  await run(
    conn,
    `certbot --nginx -d '${domain}' --non-interactive --agree-tos ${account} --redirect --keep-until-expiring`,
    log,
  );
  log(t("httpsConfigured"));
}

/**
 * HTTPS for an imported app served by its own hand-written nginx config.
 * `certbot --nginx` edits whatever config already serves the domain — it does
 * not care that the config was not written by Plantar — and validates and
 * reloads nginx itself, so Plantar rewrites no config file here.
 */
export async function setupExternalHttps(
  conn: SshConnection,
  domain: string,
  log: (line: string) => void = () => {},
  email?: string,
): Promise<void> {
  // An imported app may live on a server that never went through Plantar's
  // setup — fail with a clear message instead of a "command not found"
  const certbot = await conn.exec(TOOL_VERSION_COMMANDS.certbot);
  if (certbot.code !== 0) throw new Error(t("certbotNotInstalled"));
  await setupSsl(conn, domain, log, email);
}

/**
 * Отключает прежний nginx-конфиг импортированного приложения, чтобы он
 * не конфликтовал с конфигом Plantar. Трогает только sites-enabled:
 * конфиг в другом месте безопаснее отключить вручную.
 */
export async function disableForeignNginxConf(
  conn: SshConnection,
  confFile: string,
  name: string,
  log: (line: string) => void,
): Promise<void> {
  const ownPaths = [
    `/etc/nginx/sites-available/${name}.conf`,
    `/etc/nginx/sites-enabled/${name}.conf`,
  ];
  // Прежний конфиг совпадает с конфигом Plantar — он просто перезапишется
  if (ownPaths.includes(confFile)) return;
  if (!confFile.startsWith("/etc/nginx/sites-enabled/")) {
    log(t("takeoverNginxManual", { file: confFile }));
    return;
  }
  log(t("takeoverDisablingNginx", { file: confFile }));
  const quoted = shellQuote(confFile);
  // Симлинк удаляем (оригинал остаётся в sites-available); обычный файл
  // переносим из sites-enabled, чтобы nginx перестал его подхватывать.
  // Уже отключённый файл (takeover + проверка домена) тихо пропускается.
  await run(
    conn,
    `if [ -L ${quoted} ]; then rm -f ${quoted}; ` +
      `elif [ -e ${quoted} ]; then mv ${quoted} /etc/nginx/sites-available/"$(basename ${quoted})".imported; fi`,
    log,
  );
}
