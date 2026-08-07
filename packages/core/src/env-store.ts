import type { SshConnection } from "@plantar/ssh";
import { t } from "./messages";

/** Env-файлы проектов живут на сервере вне папок релизов — деплой их не затирает */
const ENV_STORE_DIR = "/var/www/.plantar/env";
export const envStorePath = (name: string) => `${ENV_STORE_DIR}/${name}.env`;

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
    throw new Error(t("envSaveFailed", { stderr: result.stderr.slice(-2000) }));
  }
}

/** KEY=VALUE-строки env-файла; комментарии и мусор пропускаются, кавычки вокруг значения снимаются */
export function parseEnv(content: string): Record<string, string> {
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
