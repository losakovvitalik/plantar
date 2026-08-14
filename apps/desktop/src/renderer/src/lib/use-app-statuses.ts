import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStatus, ServerRecord } from "../../../preload/index.d";
import { canConnectSilently } from "./server-auth";

/** Итог проверки одного сервера + статусы его приложений */
export interface ServerAppStatuses {
  kind: "checking" | "ok" | "unreachable" | "needsPassword" | "identityChanged";
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
  // Servers that answered with a key other than the stored one. Kept aside
  // because the sweep below cannot re-establish the fact for a password
  // server: it never connects to one, so it would report "needs password"
  // and quietly drop the state on the next refresh
  const identityChanged = useRef(new Set<string>());

  /** The kind a server gets while a check of it is under way. A server whose
   *  identity is in question keeps saying so: "checking" would blink the
   *  warning off the screen on every mount, deploy and refresh, and for a key
   *  server the check it blinks for is a connection that will be refused */
  const sweepKind = (serverId: string) =>
    identityChanged.current.has(serverId)
      ? ("identityChanged" as const)
      : ("checking" as const);

  // Any operation on a server runs into the changed key; for a password server
  // that operation is the only thing that ever will
  useEffect(
    () =>
      window.plantar.onServerIdentityChanged(({ serverId }) => {
        identityChanged.current.add(serverId);
        // Last check's data stays, as the interface promises for non-ok kinds —
        // wiping it here would blink the project dots away when the event lands
        setStatuses((prev) => ({
          ...prev,
          [serverId]: {
            ...prev[serverId],
            kind: "identityChanged",
            apps: prev[serverId]?.apps ?? {},
          },
        }));
      }),
    [],
  );

  const refresh = useCallback(async () => {
    if (servers.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    // Main owns which identities are in question, and an operation there can
    // settle the question between sweeps — the server presented the recorded
    // key again. This sweep never connects to a password server, so it cannot
    // find that out on its own: re-read the list every time and replace the
    // copy, or a question main already settled would be re-asserted here from
    // a stale one for as long as the window lives.
    const inQuestion = await window.plantar.getIdentityChangedServers();
    if (inQuestion.ok) identityChanged.current = new Set(inQuestion.data);
    // Прежние статусы остаются на экране, пока идёт проверка
    setStatuses((prev) =>
      Object.fromEntries(
        servers.map((s) => [
          s.id,
          { ...prev[s.id], kind: sweepKind(s.id), apps: prev[s.id]?.apps ?? {} },
        ]),
      ),
    );
    const set = (id: string, value: ServerAppStatuses) =>
      setStatuses((prev) => ({ ...prev, [id]: value }));
    await Promise.all(
      servers.map(async (server) => {
        if (!(await canConnectSilently(server))) {
          set(server.id, {
            kind: identityChanged.current.has(server.id)
              ? "identityChanged"
              : "needsPassword",
            apps: {},
          });
          return;
        }
        const result = await window.plantar.getAppStatuses(server.id);
        if (result.ok) {
          identityChanged.current.delete(server.id);
          set(server.id, {
            kind: "ok",
            apps: result.data.apps,
            checkedAt: result.data.checkedAt,
          });
        } else if (result.code === "host-key-rejected") {
          // The server answers, but with a key other than the stored one: its
          // own state, not "no connection" — the server header explains it
          identityChanged.current.add(server.id);
          set(server.id, { kind: "identityChanged", apps: {} });
        } else {
          // Соединение могло закрыться между проверкой и запросом — для
          // password-сервера это «нужен пароль», а не «нет связи»
          // A server whose identity is in question keeps saying so even when
          // the check fails for another reason (the impostor stopped answering,
          // a timeout): main still holds the question, and the next sweep's
          // reset would flip the kind right back — a blink, not a state
          set(server.id, {
            kind: identityChanged.current.has(server.id)
              ? "identityChanged"
              : server.auth === "password"
                ? "needsPassword"
                : "unreachable",
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
        // Main knows about a changed identity found while this window did not
        // exist — the event that reports it had nowhere to go then. Asked for
        // before the first sweep, so the warning is on screen from the start;
        // for a password server the sweep would never find it out at all.
        // Together with the cache: neither needs the other, and the cached
        // statuses are what makes the first render instant
        const [inQuestion, cached] = await Promise.all([
          window.plantar.getIdentityChangedServers(),
          window.plantar.getAppStatusCache(),
        ]);
        // Kept even when this pass was superseded: the fact belongs to the
        // server, not to one render — dropping it would lose the warning again
        if (inQuestion.ok) {
          for (const id of inQuestion.data) identityChanged.current.add(id);
        }
        if (active && cached.ok) {
          setStatuses((prev) => {
            const next = { ...prev };
            for (const server of servers) {
              const entry = cached.data[server.id];
              // Кэш password-сервера не показываем: живой проверки не будет,
              // устаревшие статусы так и остались бы на экране
              if (!entry || server.auth !== "key" || next[server.id]) continue;
              next[server.id] = {
                kind: sweepKind(server.id),
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
