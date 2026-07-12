import { type Messages, createT } from "@plantar/i18n";

const MESSAGES = {
  mkdirFailed: {
    ru: "Не удалось создать директории на сервере: {stderr}",
    en: "Failed to create directories on the server: {stderr}",
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
