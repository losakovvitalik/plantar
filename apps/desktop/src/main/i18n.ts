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
  fileNotFound: {
    ru: "Файл не найден на сервере.",
    en: "The file was not found on the server.",
  },
  unknownMonitoringTool: {
    ru: "Неизвестный инструмент мониторинга.",
    en: "Unknown monitoring tool.",
  },
  deployAlreadyRunning: {
    ru: "Деплой этого проекта уже выполняется.",
    en: "A deploy of this project is already running.",
  },
  installKeyFailed: {
    ru: "Не удалось установить ключ на сервер:\n{stderr}",
    en: "Failed to install the key on the server:\n{stderr}",
  },
  pickKeyFileTitle: {
    ru: "Выберите файл приватного ключа",
    en: "Select the private key file",
  },
  keyFileMissing: {
    ru: "Укажите файл ключа.",
    en: "Choose the key file.",
  },
  keyFileInvalid: {
    ru: "Этот файл не похож на приватный SSH-ключ. Обычно нужный файл называется id_ed25519 или id_rsa — без окончания .pub.",
    en: "This file does not look like a private SSH key. The right file is usually named id_ed25519 or id_rsa — without the .pub ending.",
  },
  keyPassphraseUnsupported: {
    ru: "Этот ключ защищён собственным паролем (passphrase) — такие ключи пока не поддерживаются. Выберите ключ без пароля.",
    en: "This key is protected by its own passphrase — such keys are not supported yet. Choose a key without a passphrase.",
  },
  keyAuthFailed: {
    ru: "Сервер не принял этот ключ. Проверьте, что на сервер добавлен именно он и что пользователь указан верно.",
    en: "The server did not accept this key. Check that this exact key is added to the server and the user is correct.",
  },
  deployUpdatingRepo: {
    ru: "Обновляю проект из репозитория…",
    en: "Updating the project from the repository…",
  },
  invalidRepoUrl: {
    ru: "Ссылка на репозиторий должна начинаться с https://",
    en: "The repository link must start with https://",
  },
  invalidBranch: {
    ru: "Недопустимое имя ветки.",
    en: "Invalid branch name.",
  },
  gitNotAvailable: {
    ru: "Не найден git. Установите его, чтобы работать с репозиториями.",
    en: "git was not found. Install it to work with repositories.",
  },
  lsRemoteFailed: {
    ru: "Не удалось получить ветки репозитория:\n{message}",
    en: "Failed to read the repository branches:\n{message}",
  },
  cloneFailed: {
    ru: "Не удалось скачать репозиторий:\n{message}",
    en: "Failed to download the repository:\n{message}",
  },
  updateFailed: {
    ru: "Не удалось обновить проект из репозитория:\n{message}",
    en: "Failed to update the project from the repository:\n{message}",
  },
  keychainUnavailable: {
    ru: "Системное хранилище недоступно — токен нельзя сохранить безопасно.",
    en: "The system keychain is unavailable — the token cannot be stored securely.",
  },
  githubRequestFailed: {
    ru: "GitHub ответил ошибкой (код {status}).",
    en: "GitHub responded with an error (status {status}).",
  },
  githubDeviceFailed: {
    ru: "Не удалось начать вход через GitHub. Попробуйте ещё раз.",
    en: "Failed to start GitHub sign-in. Please try again.",
  },
  githubAccessDenied: {
    ru: "Вход отклонён на стороне GitHub.",
    en: "Sign-in was denied on the GitHub side.",
  },
  githubDeviceExpired: {
    ru: "Время на подтверждение входа истекло. Попробуйте ещё раз.",
    en: "The sign-in confirmation window expired. Please try again.",
  },
  subdirOutside: {
    ru: "Папка должна находиться внутри репозитория.",
    en: "The folder must be inside the repository.",
  },
  removeKeyFailed: {
    ru: "Не удалось убрать прежний ключ с сервера:\n{stderr}",
    en: "Failed to remove the previous key from the server:\n{stderr}",
  },
  actionsGitOnly: {
    ru: "Деплой при коммите доступен только проектам из GitHub-репозитория.",
    en: "Deploy on commit is only available for projects added from a GitHub repository.",
  },
  actionsScopeMissing: {
    ru: "Войдите в GitHub заново: приложению нужно разрешение на изменение файлов автоматизации в репозитории.",
    en: "Sign in to GitHub again: the app needs permission to change automation files in the repository.",
  },
  actionsGithubOnly: {
    ru: "Деплой при коммите работает только с репозиториями на github.com.",
    en: "Deploy on commit only works with repositories on github.com.",
  },
  actionsLoginRequired: {
    ru: "Сначала войдите в GitHub.",
    en: "Sign in to GitHub first.",
  },
  actionsApiFailed: {
    ru: "GitHub отклонил запрос (код {status}). {message}",
    en: "GitHub rejected the request (status {status}). {message}",
  },
  subdirMissing: {
    ru: "Папка «{subdir}» не найдена в репозитории.",
    en: "The folder “{subdir}” was not found in the repository.",
  },
  externalNeedsFolder: {
    ru: "Сначала укажите папку с кодом проекта — кнопка на вкладке «Деплой».",
    en: "First choose the folder with the project code — the button is on the Deploy tab.",
  },
  rollbackUnavailableExternal: {
    ru: "Возврат предыдущей версии станет доступен после первого деплоя через Plantar.",
    en: "Restoring the previous version becomes available after the first deploy via Plantar.",
  },
  linkFolderUnavailable: {
    ru: "Папку с кодом можно привязать только к проекту, импортированному с сервера.",
    en: "A code folder can only be linked to a project imported from the server.",
  },
  linkRepoUnavailable: {
    ru: "У этого проекта нет обнаруженного репозитория — укажите папку с кодом.",
    en: "This project has no detected repository — choose the folder with its code.",
  },
  branchNotGit: {
    ru: "Сменить ветку можно только у проекта, добавленного из GitHub.",
    en: "The branch can only be changed for a project added from GitHub.",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
