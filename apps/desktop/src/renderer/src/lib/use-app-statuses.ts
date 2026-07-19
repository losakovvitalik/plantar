import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStatus, ServerRecord } from "../../../preload/index.d";
import { canConnectSilently } from "./server-auth";

/** Итог проверки одного сервера + статусы его приложений */
export interface ServerAppStatuses {
  kind: "checking" | "ok" | "unreachable" | "needsPassword";
  /** projectId → статус; при kind ≠ ok — данные прошлой проверки */
  apps: Record<string, AppStatus>;
  checkedAt?: string;
}

/**
 * Статусы приложений на серверах для индикаторов в сайдбаре.
 * При первом списке серверов мгновенно показывает кэш прошлого сеанса,
 * затем опрашивает сервера; список обновляется после добавлений и деплоев —
 * каждое обновление перепроверяет статусы. Пароль никогда не запрашивается:
 * без живого соединения статус остаётся «неизвестен».
 */
export function useAppStatuses(servers: ServerRecord[]) {
  const [statuses, setStatuses] = useState<Record<string, ServerAppStatuses>>({});
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (servers.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    // Прежние статусы остаются на экране, пока идёт проверка
    setStatuses((prev) =>
      Object.fromEntries(
        servers.map((s) => [
          s.id,
          { ...prev[s.id], kind: "checking" as const, apps: prev[s.id]?.apps ?? {} },
        ]),
      ),
    );
    const set = (id: string, value: ServerAppStatuses) =>
      setStatuses((prev) => ({ ...prev, [id]: value }));
    await Promise.all(
      servers.map(async (server) => {
        if (!(await canConnectSilently(server))) {
          set(server.id, { kind: "needsPassword", apps: {} });
          return;
        }
        const result = await window.plantar.getAppStatuses(server.id);
        if (result.ok) {
          set(server.id, {
            kind: "ok",
            apps: result.data.apps,
            checkedAt: result.data.checkedAt,
          });
        } else {
          // Соединение могло закрыться между проверкой и запросом — для
          // password-сервера это «нужен пароль», а не «нет связи»
          set(server.id, {
            kind: server.auth === "password" ? "needsPassword" : "unreachable",
            apps: {},
          });
        }
      }),
    );
    setRefreshing(false);
    inFlight.current = false;
  }, [servers]);

  const cacheLoaded = useRef(false);
  useEffect(() => {
    if (servers.length === 0) return;
    let active = true;
    void (async () => {
      if (!cacheLoaded.current) {
        cacheLoaded.current = true;
        const cached = await window.plantar.getAppStatusCache();
        if (active && cached.ok) {
          setStatuses((prev) => {
            const next = { ...prev };
            for (const server of servers) {
              const entry = cached.data[server.id];
              // Кэш password-сервера не показываем: живой проверки не будет,
              // устаревшие статусы так и остались бы на экране
              if (!entry || server.auth !== "key" || next[server.id]) continue;
              next[server.id] = {
                kind: "checking",
                apps: entry.apps,
                checkedAt: entry.checkedAt,
              };
            }
            return next;
          });
        }
      }
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, [servers, refresh]);

  return { statuses, refreshing, refresh };
}
