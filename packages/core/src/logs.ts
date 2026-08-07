import { type SshConnection, shellQuote } from "@plantar/ssh";
import { appAccessLogPath, appErrorLogPath } from "./paths";

export interface SiteLogs {
  access: string;
  error: string;
}

export async function getSiteLogs(
  conn: SshConnection,
  siteName: string,
  lines = 50,
): Promise<SiteLogs> {
  const read = async (logPath: string) => {
    const result = await conn.exec(`tail -n ${lines} '${logPath}' 2>/dev/null`);
    return result.stdout.trimEnd();
  };
  return {
    access: await read(appAccessLogPath(siteName)),
    error: await read(appErrorLogPath(siteName)),
  };
}

/** Источник живых логов: приложение (pm2) или nginx */
export type LogStreamSource = "app" | "nginx";

/**
 * Shell expression of a default pm2 log file — the single place the
 * "$HOME/.pm2/logs/" template is spelled out. $HOME has to stay expandable,
 * so only the file name is quoted: the shell glues the two adjacent parts
 * into one argument.
 */
export const pm2LogExpr = (pm2Name: string, suffix: "out" | "error"): string =>
  `"$HOME/.pm2/logs/"${shellQuote(`${pm2Name}-${suffix}.log`)}`;

/**
 * Команда live-хвоста логов для execStream: stdout канала — обычный вывод
 * (у nginx — access), stderr — ошибки. tail -F переживает ротацию и появление
 * файла позже (например, до первого деплоя).
 */
export function logStreamCommand(
  source: LogStreamSource,
  siteName: string,
  lines = 200,
  /** Явные пути к логам — у импортированных приложений они бывают нестандартными */
  paths?: { out: string; err: string },
): string {
  const [out, err] = paths
    ? [shellQuote(paths.out), shellQuote(paths.err)]
    : source === "app"
      ? [pm2LogExpr(siteName, "out"), pm2LogExpr(siteName, "error")]
      : [shellQuote(appAccessLogPath(siteName)), shellQuote(appErrorLogPath(siteName))];
  // Жалобы самих tail (нет файла и т.п.) глушатся, чтобы не мешаться с логами;
  // >&2 до 2>/dev/null: сначала stdout уходит в канал stderr, потом stderr tail — в null.
  // cat ждёт EOF по stdin (закрытие канала) и убивает tail — иначе они висят на сервере
  return (
    `tail -n ${lines} -F ${out} 2>/dev/null & OUT_PID=$!; ` +
    `tail -n ${lines} -F ${err} >&2 2>/dev/null & ERR_PID=$!; ` +
    `cat >/dev/null 2>&1; kill $OUT_PID $ERR_PID 2>/dev/null`
  );
}
