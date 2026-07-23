import type { SshConnection } from "@plantar/ssh";
import { shellQuote } from "@plantar/ssh";
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
    const logs = await conn.exec(`pm2 logs '${name}' --nostream --lines 30 2>&1`);
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
    throw new ProcessUnstableError(
      t("processUnstable", { name, logs: logs.stdout.slice(-3000) }),
    );
  }
  log(t("processStable"));
}

/**
 * Смоук-проверка после деплоя: запрос к публичному адресу с самого сервера,
 * чтобы проверить всю цепочку nginx → приложение (без влияния DNS и сети
 * пользователя). Редиректы и коды авторизации — сайт отвечает; 502/503/504
 * или отсутствие ответа — прокси не достучался до приложения. Неудача не
 * роняет деплой, а заменяет «сайт доступен» предупреждением.
 */
export async function verifySiteAvailable(
  conn: SshConnection,
  url: string,
  liveMessage: "siteAvailable" | "appAvailable",
  log: (line: string) => void,
): Promise<void> {
  log(t("checkingSiteUrl", { url }));
  // -k: проверяем доступность, а не сертификат; ретраи — nginx/приложению
  // может понадобиться пара секунд после перезагрузки
  const check = await conn.exec(
    `for i in 1 2 3 4 5; do ` +
      `code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 ${shellQuote(url)} 2>/dev/null || true); ` +
      `case "$code" in ''|000|502|503|504) sleep 2;; *) echo "$code"; exit 0;; esac; ` +
      `done; echo "$code"; exit 1`,
  );
  const code = check.stdout.trim().split("\n").pop() ?? "";
  if (check.code === 0) {
    log(t(liveMessage, { url }));
  } else if (code === "" || code === "000") {
    log(t("siteCheckNoResponse", { url }));
  } else {
    log(t("siteCheckBadGateway", { url, code }));
  }
}
