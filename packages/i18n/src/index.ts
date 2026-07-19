/**
 * Общий механизм локализации для Node-кода (пакеты, main-процесс desktop, CLI).
 * Словари живут рядом с кодом каждого пакета; здесь — текущий язык процесса
 * и фабрика t(). Словари renderer устроены отдельно (React-контекст
 * в apps/desktop/src/renderer/src/i18n) — это другой процесс.
 */
export type Language = "ru" | "en";

/** Язык по умолчанию — из локали системы; для всех, кроме русскоязычных, — английский */
export function systemLanguage(): Language {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
  return locale.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let currentLanguage: Language = systemLanguage();

export function getLanguage(): Language {
  return currentLanguage;
}

/** Приложение вызывает это при старте (из настроек) и при их смене */
export function setLanguage(language: Language): void {
  currentLanguage = language;
}

export type Messages<K extends string> = Record<K, Record<Language, string>>;

/** t() для словаря пакета: перевод по текущему языку процесса, подстановки — {имя} */
export function createT<K extends string>(messages: Messages<K>) {
  return (key: K, params?: Record<string, string | number>): string => {
    const template = messages[key][currentLanguage];
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}
