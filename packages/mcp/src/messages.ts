import { type Messages, createT } from "@plantar/i18n";

const MESSAGES = {
  serverNotFound: {
    ru: "Сервер с таким идентификатором не найден. Вызовите list_servers, чтобы увидеть доступные серверы.",
    en: "No server with this id. Call list_servers to see the available servers.",
  },
  projectNotFound: {
    ru: "Проект с таким идентификатором не найден. Вызовите list_projects, чтобы увидеть доступные проекты.",
    en: "No project with this id. Call list_projects to see the available projects.",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
