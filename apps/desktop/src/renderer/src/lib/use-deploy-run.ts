import { useEffect, useRef, useState } from "react";
import type { SiteCheckStatus } from "../../../preload/index.d";

/** Лимит строк терминала — как у буфера прогона в main; длинный лог
 *  восстановленного npm install не должен раздувать DOM */
const MAX_TERMINAL_LINES = 2000;

/** Прогон деплоя глазами вкладки — зеркало состояния main */
export interface RunView {
  status: "running" | "success" | "error" | "interrupted";
  kind: "deploy" | "rollback" | "migrate";
  startedAt: string;
  url: string | null;
  /** How the address answered the availability check; null — nothing to check */
  urlCheck: SiteCheckStatus | null;
  error: { message: string; code?: string } | null;
}

/**
 * Mirrors the deploy run of one project from main: the state snapshot, the
 * log/finish subscriptions with the seq/pending race handling, rAF batching
 * of incoming lines and the step-start timestamp for the running-step
 * counter. Actions reset the mirror through startRunView and report
 * pre-start failures through failRun.
 */
export function useDeployRun(projectId: string) {
  // Состояние прогона живёт в main; вкладка показывает его снимок + события
  const [run, setRun] = useState<RunView | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  // Пока снимок не получен, кнопки неактивны — иначе можно запустить второй деплой
  const [stateLoaded, setStateLoaded] = useState(false);
  const lastSeqRef = useRef(0);

  // Длительность текущего шага: долгие команды (npm install, сборка) не пишут в лог
  // до завершения, и без бегущего счётчика деплой выглядит зависшим.
  // Точка отсчёта — время последней строки, она переживает перемонтирование вкладки.
  // The 1-second tick and the counter itself live in StepTimer inside Terminal.
  const stepStartRef = useRef(Date.now());

  // Incoming log lines are collected here and flushed as one state update per
  // animation frame — a chatty step (npm install) must not render per line
  const lineBatchRef = useRef<string[]>([]);
  const flushHandleRef = useRef<number | null>(null);

  function flushLineBatch() {
    flushHandleRef.current = null;
    const chunk = lineBatchRef.current;
    if (chunk.length === 0) return;
    lineBatchRef.current = [];
    setLines((prev) => [...prev, ...chunk].slice(-MAX_TERMINAL_LINES));
  }

  /** Drop batched-but-unflushed lines — they belong to the run being discarded */
  function clearLineBatch() {
    if (flushHandleRef.current !== null) {
      window.cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    lineBatchRef.current = [];
  }

  useEffect(() => {
    setRun(null);
    setLines([]);
    setStateLoaded(false);
    lastSeqRef.current = 0;
    clearLineBatch();
    let disposed = false;
    let loaded = false;
    // Строки, пришедшие между запросом снимка и ответом, — применяются после снимка
    const pending: { seq: number; line: string }[] = [];

    const append = (seq: number, line: string) => {
      // Номера строк закрывают гонку снимка и подписки: дубли отбрасываются
      if (seq <= lastSeqRef.current) return;
      lastSeqRef.current = seq;
      stepStartRef.current = Date.now();
      lineBatchRef.current.push(line);
      // Cap at push time: backgroundThrottling pauses rAF while the window is
      // hidden, and only the last MAX_TERMINAL_LINES survive the flush anyway
      if (lineBatchRef.current.length > MAX_TERMINAL_LINES) {
        lineBatchRef.current = lineBatchRef.current.slice(-MAX_TERMINAL_LINES);
      }
      if (flushHandleRef.current === null) {
        flushHandleRef.current = window.requestAnimationFrame(flushLineBatch);
      }
    };

    const unsubscribeLog = window.plantar.onDeployLog((event) => {
      if (event.projectId !== projectId) return;
      if (!loaded) {
        pending.push(event);
        return;
      }
      append(event.seq, event.line);
    });
    const unsubscribeFinished = window.plantar.onDeployFinished((event) => {
      if (event.projectId !== projectId) return;
      setRun(
        (prev) =>
          prev && {
            ...prev,
            status: event.status,
            url: event.url ?? null,
            urlCheck: event.urlCheck ?? null,
            error:
              event.status === "error"
                ? { message: event.error ?? "", code: event.code }
                : null,
          },
      );
    });

    void window.plantar.getDeployState(projectId).then((result) => {
      if (disposed) return;
      loaded = true;
      setStateLoaded(true);
      if (!result.ok || !result.data) return;
      const state = result.data;
      lastSeqRef.current = state.lastSeq;
      setLines(state.lines.slice(-MAX_TERMINAL_LINES));
      setRun({
        status: state.status,
        kind: state.kind,
        startedAt: state.startedAt,
        url: state.url ?? null,
        urlCheck: state.urlCheck ?? null,
        error: state.error
          ? { message: state.error, code: state.errorCode }
          : null,
      });
      if (state.status === "running") {
        // Счётчик шага продолжается от последней строки, а не с нуля
        stepStartRef.current =
          Date.parse(state.lastLineAt || state.startedAt) || Date.now();
      }
      for (const event of pending) append(event.seq, event.line);
    });

    return () => {
      disposed = true;
      unsubscribeLog();
      unsubscribeFinished();
      clearLineBatch();
    };
  }, [projectId]);

  /** Сброс вкладки под новый прогон — до ответа main, чтобы клик отзывался мгновенно */
  function startRunView(kind: RunView["kind"]) {
    setRun({
      status: "running",
      kind,
      startedAt: new Date().toISOString(),
      url: null,
      urlCheck: null,
      error: null,
    });
    setLines([]);
    lastSeqRef.current = 0;
    stepStartRef.current = Date.now();
    clearLineBatch();
  }

  /** Успех и ошибки прогона приходят событием deploy:finished;
   *  сюда попадают только ошибки до старта прогона (валидация) */
  function failRun(message: string, code?: string) {
    setRun((prev) =>
      prev && prev.status === "running"
        ? { ...prev, status: "error", error: { message, code } }
        : prev,
    );
  }

  return { run, lines, stateLoaded, stepStartRef, startRunView, failRun };
}
