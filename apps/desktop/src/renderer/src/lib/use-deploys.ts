import { useEffect, useState } from "react";
import type { DeployStartedEvent } from "../../../preload/index.d";

/**
 * Идущие сейчас прогоны для индикаторов деплоя в сайдбаре: projectId → вид
 * прогона. Начальное состояние — снимок из main, дальше живёт на событиях
 * старта и завершения; на строки лога не подписан, чтобы сайдбар не
 * перерисовывался на каждую строчку.
 */
export function useDeploys(): Record<string, DeployStartedEvent["kind"]> {
  const [active, setActive] = useState<Record<string, DeployStartedEvent["kind"]>>({});

  useEffect(() => {
    let disposed = false;
    const offStarted = window.plantar.onDeployStarted(({ projectId, kind }) => {
      setActive((prev) => ({ ...prev, [projectId]: kind }));
    });
    const offFinished = window.plantar.onDeployFinished(({ projectId }) => {
      setActive((prev) => {
        const { [projectId]: _, ...rest } = prev;
        return rest;
      });
    });
    // Снимок после подписки: прогон, стартовавший между запросом и ответом,
    // не потеряется — событие старта уже слушается
    void window.plantar.getActiveDeploys().then((result) => {
      if (disposed || !result.ok) return;
      setActive((prev) => {
        const next = { ...prev };
        for (const { projectId, kind } of result.data) next[projectId] = kind;
        return next;
      });
    });
    return () => {
      disposed = true;
      offStarted();
      offFinished();
    };
  }, []);

  return active;
}
