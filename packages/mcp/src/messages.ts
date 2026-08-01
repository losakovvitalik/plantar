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
  noDeployRun: {
    ru: "В этом запуске приложения деплоев этого проекта не было. Прошлые деплои смотрите через get_deploy_history.",
    en: "No deploy runs of this project in this app session. Call get_deploy_history for past deploys.",
  },
  bypassHint: {
    ru: "Не обходите эту ошибку прямым подключением к серверу по SSH по собственной инициативе — сообщите о проблеме пользователю; подключаться напрямую можно только с его явного разрешения в чате.",
    en: "Do not work around this by connecting to the server directly over SSH on your own initiative — report the problem to the user; connect directly only with their explicit permission in the chat.",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
