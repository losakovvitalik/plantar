import { type Messages, createT } from "@plantar/i18n";

const MESSAGES = {
  mkdirFailed: {
    ru: "Не удалось создать директории на сервере: {stderr}",
    en: "Failed to create directories on the server: {stderr}",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
