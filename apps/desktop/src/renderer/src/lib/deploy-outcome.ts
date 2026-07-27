/** Итог успешного прогона глазами вкладки «Деплой» */
export type DeployOutcome =
  | { kind: "none" }
  | { kind: "link"; url: string; rolledBack: boolean }
  | { kind: "unreachable"; url: string; rolledBack: boolean }
  | { kind: "done"; rolledBack: boolean };

interface RunResult {
  status: "running" | "success" | "error" | "interrupted";
  kind: "deploy" | "rollback" | "migrate";
  url?: string | null;
  urlReachable?: boolean | null;
}

/**
 * Ссылка на адрес приложения обещает рабочий сайт, поэтому она показывается
 * только когда адрес ответил на проверку. Не ответил — нейтральная строка:
 * код обновился, но по этому адресу приложения нет (у импортированного
 * приложения Plantar не настраивает веб-сервер, домен мог остаться прежним).
 */
export function deployOutcome(run: RunResult | null): DeployOutcome {
  if (!run || run.status !== "success") return { kind: "none" };
  const rolledBack = run.kind === "rollback";
  if (!run.url) return { kind: "done", rolledBack };
  return {
    kind: run.urlReachable === false ? "unreachable" : "link",
    url: run.url,
    rolledBack,
  };
}
