import type { ServerRecord } from "../../../preload/index.d";

/** Можно ли обратиться к серверу без запроса пароля: ключ или уже живое соединение */
export async function canConnectSilently(server: ServerRecord): Promise<boolean> {
  if (server.auth === "key") return true;
  const result = await window.plantar.isServerConnected(server.id);
  return result.ok && result.data;
}

/**
 * Пароль для операции с сервером: undefined — не нужен (ключ или живое
 * соединение), null — пользователь отменил ввод.
 */
export async function passwordFor(
  server: ServerRecord,
  askPassword: (server: ServerRecord) => Promise<string | null>,
): Promise<string | undefined | null> {
  if (await canConnectSilently(server)) return undefined;
  return askPassword(server);
}
