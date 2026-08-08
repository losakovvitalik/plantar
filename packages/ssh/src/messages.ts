import { type Messages, createT } from "@plantar/i18n";

const MESSAGES = {
  connectFailed: {
    ru: "Не удалось подключиться к серверу {host} (пользователь {user}): {error}",
    en: "Could not connect to the server {host} (user {user}): {error}",
  },
  hostKeyRejected: {
    ru: "Сервер {host} предъявил не тот опознавательный ключ, что был сохранён при первом подключении ({fingerprint}). Подключение прервано.",
    en: "The server {host} presented a different identifying key ({fingerprint}) than the one saved on the first connection. The connection was stopped.",
  },
  mkdirFailed: {
    ru: "Не удалось создать папку {dir} на сервере {host}: {stderr}",
    en: "Failed to create the folder {dir} on the server {host}: {stderr}",
  },
  uploadingArchive: {
    ru: "→ Загружаю архив ({size} МБ)…",
    en: "→ Uploading the archive ({size} MB)…",
  },
  extractFailed: {
    ru: "Не удалось распаковать архив на сервере: {stderr}",
    en: "Failed to extract the archive on the server: {stderr}",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
