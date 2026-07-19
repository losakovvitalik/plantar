import { type Messages, createT } from "@plantar/i18n";

/** Строки CLI: описания команд и вывод; язык берётся из настроек при старте */
const MESSAGES = {
  programDescription: {
    ru: "Деплой React-приложений на Ubuntu-серверы",
    en: "Deploy React apps to Ubuntu servers",
  },
  optHost: { ru: "адрес сервера", en: "server address" },
  optPort: { ru: "SSH-порт", en: "SSH port" },
  optUser: { ru: "имя пользователя", en: "user name" },
  optPassword: { ru: "пароль (если без ключа)", en: "password (when not using a key)" },
  optKey: { ru: "путь к приватному ключу", en: "path to the private key" },
  authRequired: {
    ru: "Нужно указать --password или --key для аутентификации.",
    en: "Provide --password or --key for authentication.",
  },
  connected: { ru: "Подключено к {user}@{host}.", en: "Connected to {user}@{host}." },
  disconnected: { ru: "Отключено.", en: "Disconnected." },
  cmdLs: {
    ru: "вывести список директорий на сервере",
    en: "list directories on the server",
  },
  optLsPath: { ru: "директория для листинга", en: "directory to list" },
  lsHeader: {
    ru: "Директории в «{path}» ({count}):",
    en: "Directories in “{path}” ({count}):",
  },
  cmdInfo: {
    ru: "показать ОС, ресурсы и установленные инструменты",
    en: "show the OS, resources and installed tools",
  },
  infoOs: { ru: "ОС: {os} — {status}", en: "OS: {os} — {status}" },
  osSupported: { ru: "поддерживается", en: "supported" },
  osUnsupported: {
    ru: "НЕ поддерживается (нужна Ubuntu 22.04 или 24.04)",
    en: "NOT supported (Ubuntu 22.04 or 24.04 is required)",
  },
  infoCpu: { ru: "CPU: {count} ядер", en: "CPU: {count} cores" },
  infoRam: { ru: "RAM: {mb} МБ", en: "RAM: {mb} MB" },
  infoDisk: { ru: "Диск (свободно на /): {gb} ГБ", en: "Disk (free on /): {gb} GB" },
  infoTools: { ru: "Инструменты:", en: "Tools:" },
  notInstalled: { ru: "не установлен", en: "not installed" },
  cmdSetup: {
    ru: "установить Node.js, pnpm, pm2, nginx и certbot",
    en: "install Node.js, pnpm, pm2, nginx and certbot",
  },
  setupDone: {
    ru: "Готово: установлено {installed}, уже было {present}.",
    en: "Done: {installed} installed, {present} already present.",
  },
  cmdDeploy: {
    ru: "собрать проект и загрузить на сервер",
    en: "build the project and upload it to the server",
  },
  optProjectDir: { ru: "папка проекта с plantar.json", en: "project folder with plantar.json" },
  deployProjectHeader: { ru: "Проект «{name}» ({dir})", en: "Project “{name}” ({dir})" },
  deployLogFile: { ru: "Лог деплоя: {file}", en: "Deploy log: {file}" },
  deployLogError: { ru: "ОШИБКА", en: "ERROR" },
  cmdLogs: {
    ru: "показать логи nginx по сайту (access и error)",
    en: "show the site's nginx logs (access and error)",
  },
  optLines: { ru: "сколько последних строк показать", en: "how many last lines to show" },
  logsEmpty: { ru: "(пусто)", en: "(empty)" },
  logsSnapshots: {
    ru: "Снапшоты сохранены локально: {dir}",
    en: "Snapshots saved locally: {dir}",
  },
  cmdHistory: {
    ru: "история деплоев (локальная, без подключения к серверу)",
    en: "deploy history (local, no server connection)",
  },
  optHistoryProject: { ru: "фильтр по имени проекта", en: "filter by project name" },
  historyEmpty: { ru: "История пуста.", en: "The history is empty." },
  historyLogFile: { ru: "  лог: {file}", en: "  log: {file}" },
  errorPrefix: { ru: "Ошибка:", en: "Error:" },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
