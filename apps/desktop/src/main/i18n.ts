import { type Language, readSettings } from "@plantar/storage";

/**
 * Строки main-процесса (ошибки IPC, системные уведомления, диалоги ОС).
 * Словарь renderer живёт отдельно в renderer/src/i18n — main не может
 * импортировать код renderer, а строк здесь немного.
 */
const MESSAGES = {
  serverNotFound: {
    ru: "Сервер не найден. Обнови список.",
    en: "Server not found. Refresh the list.",
  },
  projectNotFound: {
    ru: "Проект не найден. Обнови список.",
    en: "Project not found. Refresh the list.",
  },
  passwordRequired: {
    ru: "Для этого сервера нужен пароль.",
    en: "This server requires a password.",
  },
  enterPassword: {
    ru: "Введи пароль сервера.",
    en: "Enter the server password.",
  },
  pickProjectFolder: {
    ru: "Выбери папку проекта",
    en: "Select the project folder",
  },
  nameTaken: {
    ru: "Имя «{name}» уже занято проектом на этом сервере ({path}). Проекты с одинаковым именем деплоятся в одну папку и перетирают друг друга — укажи другое имя.",
    en: "The name “{name}” is already used by a project on this server ({path}). Projects with the same name deploy to the same folder and overwrite each other — pick a different name.",
  },
  notifySuccessTitle: { ru: "Деплой завершён", en: "Deploy finished" },
  notifySuccessBody: {
    ru: "Проект «{name}» опубликован.",
    en: "Project “{name}” is live.",
  },
  notifyErrorTitle: { ru: "Деплой не удался", en: "Deploy failed" },
  notifyErrorBody: {
    ru: "Проект «{name}» — произошла ошибка.",
    en: "Project “{name}” — an error occurred.",
  },
  deployLogError: { ru: "ОШИБКА", en: "ERROR" },
  invalidEnvFileName: {
    ru: "Недопустимое имя env-файла.",
    en: "Invalid env file name.",
  },
  invalidLogPath: {
    ru: "Недопустимый путь к файлу лога.",
    en: "Invalid log file path.",
  },
  installKeyFailed: {
    ru: "Не удалось установить ключ на сервер:\n{stderr}",
    en: "Failed to install the key on the server:\n{stderr}",
  },
} satisfies Record<string, Record<Language, string>>;

type MainMessageKey = keyof typeof MESSAGES;

let currentLanguage: Language = readSettings().language;

/** Вызывается при сохранении настроек, чтобы новые сообщения шли на выбранном языке */
export function setLanguage(language: Language): void {
  currentLanguage = language;
}

export function t(
  key: MainMessageKey,
  params?: Record<string, string | number>,
): string {
  const template = MESSAGES[key][currentLanguage];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
