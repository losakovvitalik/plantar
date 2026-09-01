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
  hostKeyNoLongerPresented: {
    ru: "Сервер отвечает уже не тем ключом, который был показан. Посмотрите ключ выше ещё раз, прежде чем соглашаться.",
    en: "The server no longer answers with the key that was shown. Look at the key above once more before agreeing.",
  },
  // Verbatim twin of the renderer's trustHostKey.settled (renderer/src/i18n):
  // after a refused confirmation the dialog shows both at once — the error box
  // and the fingerprint box — so reword the two together
  hostKeyQuestionSettled: {
    ru: "Сервер снова отвечает прежним ключом — запоминать нечего.",
    en: "The server answers with its previous key again — there is nothing to remember.",
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
  notifyNoAnswerTitle: {
    ru: "Деплой завершён, но сайт не ответил",
    en: "Deploy finished, but the site did not respond",
  },
  notifyNoAnswerBody: {
    ru: "Проект «{name}» обновлён, но по своему адресу не ответил. Подробности — в приложении.",
    en: "Project “{name}” was updated but did not respond at its address. See the app for details.",
  },
  notifyPlainHttpTitle: {
    ru: "Деплой завершён, но сайт нужно проверить",
    en: "Deploy finished, but check the site",
  },
  notifyPlainHttpBody: {
    ru: "Проект «{name}» обновлён, но ответил только по незащищённому адресу. Подробности — в приложении.",
    en: "Project “{name}” was updated but only responded at its insecure address. See the app for details.",
  },
  deployLogError: { ru: "ОШИБКА", en: "ERROR" },
  notifyAppDownTitle: {
    ru: "Приложение перестало работать",
    en: "App stopped working",
  },
  notifyAppDownBody: {
    ru: "«{name}» на сервере «{server}» не отвечает.",
    en: "“{name}” on server “{server}” is not responding.",
  },
  notifyAppUpTitle: {
    ru: "Приложение снова работает",
    en: "App is working again",
  },
  notifyAppUpBody: {
    ru: "«{name}» на сервере «{server}» снова отвечает.",
    en: "“{name}” on server “{server}” is responding again.",
  },
  notifyServerUnreachableTitle: {
    ru: "Сервер не отвечает",
    en: "Server is not responding",
  },
  notifyServerUnreachableBody: {
    ru: "Нет связи с сервером «{name}». Приложения на нём сейчас не проверяются.",
    en: "Server “{name}” is unreachable. Its apps cannot be checked right now.",
  },
  notifyIdentityChangedTitle: {
    ru: "Сервер отвечает не так, как раньше",
    en: "The server answers differently than before",
  },
  notifyIdentityChangedBody: {
    ru: "По адресу сервера «{name}» отвечает сервер с другим опознавательным ключом. Plantar не подключается к нему и ничего туда не отправляет. Откройте приложение — там написано, что делать.",
    en: "A server with a different identifying key answers at the address of “{name}”. Plantar does not connect to it and sends nothing there. Open the app to see what to do.",
  },
  trayOpen: { ru: "Открыть Plantar", en: "Open Plantar" },
  trayQuit: { ru: "Выйти из Plantar", en: "Quit Plantar" },
  trayBackgroundTitle: {
    ru: "Plantar работает в фоне",
    en: "Plantar keeps running in the background",
  },
  trayBackgroundBody: {
    ru: "Приложение продолжает следить за серверами из значка возле часов. Чтобы выйти совсем, используйте меню значка.",
    en: "The app keeps watching your servers from the tray icon. To quit completely, use the icon’s menu.",
  },
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
  invalidCommit: {
    ru: "Недопустимый идентификатор версии.",
    en: "Invalid version identifier.",
  },
  gitNotAvailable: {
    ru: "Не найден git. Установите его, чтобы работать с репозиториями.",
    en: "git was not found. Install it to work with repositories.",
  },
  gitTooOldForTokenAuth: {
    ru: "Установленный git (версия {version}) слишком старый для доступа к приватным репозиториям. Обновите git до версии 2.31 или новее.",
    en: "The installed git (version {version}) is too old to access private repositories. Update git to version 2.31 or newer.",
  },
  repoMoved: {
    ru: "Похоже, репозиторий переехал на новый адрес: его переименовали или передали другому владельцу. Прежняя ссылка больше не работает — посмотрите новый адрес репозитория на GitHub и укажите эту ссылку.\n{message}",
    en: "The repository appears to have moved to a new address: it was renamed or handed over to another owner. The old link no longer works — look up the repository's new address on GitHub and use that link.\n{message}",
  },
  repoRedirectedByGitConfig: {
    ru: "Запрос ушёл не на GitHub, а на другой адрес — так настроен git на этом компьютере. Данные аккаунта GitHub на посторонний адрес не отправляются, поэтому приватный репозиторий выглядит как несуществующий. Проверьте настройки git.\n{message}",
    en: "The request went to a different address instead of GitHub — that is how git is set up on this computer. GitHub account data is not sent to an outside address, so a private repository looks as if it does not exist. Check the git settings.\n{message}",
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
    ru: "Для переноса под управление Plantar сначала укажите папку с кодом проекта — кнопка на вкладке «Деплой».",
    en: "To move the app under Plantar management, first choose the folder with the project code — the button is on the Deploy tab.",
  },
  rollbackUnavailableExternal: {
    ru: "У импортированного приложения версии хранятся в git — вернуть версию можно на вкладке «Версии».",
    en: "An imported app keeps its versions in git — restore a version on the Versions tab.",
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
  externalOnlyAction: {
    ru: "Это действие доступно только для приложения, импортированного с сервера.",
    en: "This action is only available for an app imported from the server.",
  },
  httpsNeedsDomain: {
    ru: "Сначала укажите адрес приложения в настройках проекта.",
    en: "First set the app address in the project settings.",
  },
  accessLogUnavailable: {
    ru: "Отдельный журнал посещений тут не завести: при импорте не нашлись настройки веб-сервера или порт этого приложения.",
    en: "A separate visits log cannot be set up here: the import did not find the web server configuration or the port of this app.",
  },
  mcpStartFailed: {
    ru: "Доступ для ИИ-агентов включить не удалось, переключатель снова выключен. Возможно, адрес уже занят другой программой — попробуйте позже.",
    en: "Access for AI agents could not be turned on, so the switch is off again. The address may already be in use by another program — please try again later.",
  },
  mcpStopFailed: {
    ru: "Доступ для ИИ-агентов выключить не удалось. Попробуйте перезапустить приложение.",
    en: "Access for AI agents could not be turned off. Please try restarting the app.",
  },
  mcpConnectInApp: {
    ru: "Этот сервер входит по паролю, и пароль не хранится. Подключитесь к серверу в приложении Plantar и повторите запрос.",
    en: "This server signs in with a password, and the password is not stored. Connect to the server in the Plantar app, then retry.",
  },
  externalLinkBlocked: {
    ru: "Ссылку не удалось открыть: она не ведёт на сайт.",
    en: "The link could not be opened: it does not lead to a website.",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
