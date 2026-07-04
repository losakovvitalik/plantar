import { type Messages, createT } from "@plantar/i18n";

export { setLanguage } from "@plantar/i18n";

/**
 * Строки main-процесса (ошибки IPC, системные уведомления, диалоги ОС).
 * Язык процесса общий с пакетами (@plantar/i18n) — index.ts задаёт его
 * из настроек при старте и при их сохранении. Словарь renderer живёт
 * отдельно в renderer/src/i18n — main не может импортировать код renderer.
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
} satisfies Messages<string>;

export const t = createT(MESSAGES);
