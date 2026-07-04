import { type Messages, createT } from "@plantar/i18n";

const MESSAGES = {
  nameRegex: {
    ru: "только строчные латинские буквы, цифры и дефис",
    en: "only lowercase latin letters, digits and hyphens",
  },
  domainRegex: {
    ru: "только латинские буквы, цифры, точки и дефис",
    en: "only latin letters, digits, dots and hyphens",
  },
  issueRoot: { ru: "(корень)", en: "(root)" },
  configInvalid: {
    ru: "plantar.json — ошибки конфигурации:\n{issues}",
    en: "plantar.json — configuration errors:\n{issues}",
  },
  configNotFound: {
    ru: "Не найден plantar.json в {dir}",
    en: "plantar.json not found in {dir}",
  },
  configBadJson: {
    ru: "plantar.json — некорректный JSON: {message}",
    en: "plantar.json — invalid JSON: {message}",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
