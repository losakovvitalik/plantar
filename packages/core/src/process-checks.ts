import type { SshConnection } from "@plantar/ssh";
import { shellQuote } from "@plantar/ssh";
import { extractPm2Json } from "./discover";
import { t } from "./messages";

/**
 * Общие шаги деплоя, которые нужны и управляемым проектам (index.ts),
 * и бережному обновлению импортированных приложений (external.ts):
 * запуск команд с логом и проверки, что приложение поднялось.
 */

/**
 * Приложение не ответило по HTTP после запуска. GUI по коду ошибки
 * предлагает вернуть предыдущую версию.
 */
export class AppNotRespondingError extends Error {
  code = "app-not-responding" as const;
}

/** Процесс не запустился или падает сразу после старта; код — для действий в GUI */
export class ProcessUnstableError extends Error {
  code = "process-unstable" as const;
}

export async function run(
  conn: SshConnection,
  command: string,
  log: (line: string) => void,
): Promise<void> {
  log(`$ ${command}`);
  const result = await conn.exec(command);
  if (result.code !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .slice(-3000);
    throw new Error(
      t("commandFailed", {
        code: result.code,
        command,
        stderr: output,
      }),
    );
  }
}

/** Ждёт, пока приложение начнёт отвечать по HTTP; при неудаче — ошибка с логами pm2 */
export async function waitForApp(
  conn: SshConnection,
  name: string,
  port: number,
  log: (line: string) => void,
): Promise<void> {
  log(t("checkingAppPort", { port }));
  // 120 попыток: тяжёлым приложениям (например, Strapi через npm start)
  // 30 секунд на запуск не хватает
  const check = await conn.exec(
    `for i in $(seq 1 120); do ` +
      `code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:${port}/); ` +
      `if [ "$code" != "000" ]; then exit 0; fi; sleep 1; done; exit 1`,
  );
  if (check.code !== 0) {
    const logs = await conn.exec(`pm2 logs ${shellQuote(name)} --nostream --lines 30 2>&1`);
    throw new AppNotRespondingError(
      t("appNotResponding", { port, logs: logs.stdout.slice(-3000) }),
    );
  }
  log(t("appResponding"));
}

interface Pm2Process {
  name: string;
  pm2_env: { status: string; pm_uptime: number };
}

/** Бот не слушает порт, поэтому вместо HTTP-проверки убеждаемся,
 *  что pm2-процесс живёт несколько секунд и не перезапускается */
export async function waitForStableProcess(
  conn: SshConnection,
  name: string,
  log: (line: string) => void,
): Promise<void> {
  log(t("checkingProcess"));
  const result = await conn.exec(`sleep 5; echo "NOW:$(date +%s%3N)"; pm2 jlist 2>/dev/null`);
  const now = Number(result.stdout.match(/^NOW:(\d+)$/m)?.[1]);

  // extractPm2Json skips pm2 service banners; unreadable output → empty list,
  // handled below as "process not found"
  const processes = extractPm2Json(result.stdout) as Pm2Process[];

  const app = processes.find((p) => p.name === name);
  const stable =
    app && app.pm2_env.status === "online" && now - app.pm2_env.pm_uptime >= 4000;
  if (!stable) {
    const logs = await conn.exec(`pm2 logs ${shellQuote(name)} --nostream --lines 30 2>&1`);
    throw new ProcessUnstableError(
      t("processUnstable", { name, logs: logs.stdout.slice(-3000) }),
    );
  }
  log(t("processStable"));
}

/**
 * Outcome of the post-deploy smoke check of the public address.
 *
 * plain-http is deliberately not a success: the answer came from an address
 * the user never configured, and on port 80 an untouched nginx replies to any
 * unknown host with its default site (or a redirect to https), so the answer
 * does not prove the app is served there.
 */
export type SiteCheckStatus = "answered" | "plain-http" | "no-answer";

/** One attempt (with retries): an answer means code === 0; an empty code or
 *  000 means nothing at all answered at the address */
async function probeUrl(
  conn: SshConnection,
  url: string,
): Promise<{ answered: boolean; code: string }> {
  // -k: availability is what is checked here, not the certificate; retries —
  // nginx or the app may need a couple of seconds after a restart
  const check = await conn.exec(
    `for i in 1 2 3 4 5; do ` +
      `code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 ${shellQuote(url)} 2>/dev/null || true); ` +
      `case "$code" in ''|000|502|503|504) sleep 2;; *) echo "$code"; exit 0;; esac; ` +
      `done; echo "$code"; exit 1`,
  );
  return {
    answered: check.code === 0,
    code: check.stdout.trim().split("\n").pop() ?? "",
  };
}

/** Nothing at all answered at the address — unlike 502/503/504, where the web
 *  server is in place but could not reach the app */
function noAnswer(code: string): boolean {
  return code === "" || code === "000";
}

const HTTPS_PREFIX = "https://";

/**
 * Смоук-проверка после деплоя: запрос к публичному адресу с самого сервера,
 * чтобы проверить всю цепочку nginx → приложение (без влияния DNS и сети
 * пользователя). Редиректы и коды авторизации — сайт отвечает; 502/503/504
 * или отсутствие ответа — прокси не достучался до приложения. Неудача не
 * роняет деплой, а заменяет «сайт доступен» предупреждением.
 *
 * Returns how the configured address answered, so the caller does not present
 * an address that stayed silent as a working link. The configured address is
 * the only one the result ever speaks about.
 *
 * httpFallback — for an imported app: its web server is set up by hand and
 * Plantar only recorded the server_name, which may well be served over plain
 * http. Nothing at all answered on https — ask http, but report that as
 * plain-http rather than as a confirmed address (see SiteCheckStatus).
 * Managed deploys do not use it: there Plantar itself set up nginx and the
 * certificate, so a silent https is a real failure.
 */
export async function verifySiteAvailable(
  conn: SshConnection,
  url: string,
  liveMessage: "siteAvailable" | "appAvailable",
  log: (line: string) => void,
  options: { httpFallback?: boolean } = {},
): Promise<SiteCheckStatus> {
  log(t("checkingSiteUrl", { url }));
  const probe = await probeUrl(conn, url);
  if (probe.answered) {
    log(t(liveMessage, { url }));
    return "answered";
  }
  if (!noAnswer(probe.code)) {
    log(t("siteCheckBadGateway", { url, code: probe.code }));
    return "no-answer";
  }
  if (options.httpFallback && url.startsWith(HTTPS_PREFIX)) {
    const plainUrl = `http://${url.slice(HTTPS_PREFIX.length)}`;
    log(t("checkingSitePlainHttp", { url: plainUrl }));
    if ((await probeUrl(conn, plainUrl)).answered) {
      log(t("siteCheckPlainHttpOnly", { url, plainUrl }));
      return "plain-http";
    }
  }
  log(t("siteCheckNoResponse", { url }));
  return "no-answer";
}
