import { type Messages, createT } from "@plantar/i18n";

/** Строки деплой-лога и ошибок core; язык процесса задаёт приложение через setLanguage */
const MESSAGES = {
  commandFailed: {
    ru: "Команда завершилась с кодом {code}: {command}\n{stderr}",
    en: "Command exited with code {code}: {command}\n{stderr}",
  },
  checkingServer: { ru: "Проверяю сервер…", en: "Checking the server…" },
  osUnsupported: {
    ru: "ОС «{os}» не поддерживается. Нужна Ubuntu {versions}.",
    en: "OS “{os}” is not supported. Ubuntu {versions} is required.",
  },
  toolPresent: {
    ru: "✓ {tool} уже установлен ({version})",
    en: "✓ {tool} is already installed ({version})",
  },
  toolInstalling: { ru: "→ Устанавливаю {tool}…", en: "→ Installing {tool}…" },
  toolMissingAfterInstall: {
    ru: "{tool}: установка прошла, но инструмент не найден в PATH.",
    en: "{tool}: the install finished, but the tool is not found in PATH.",
  },
  toolInstalled: {
    ru: "✓ {tool} установлен ({version})",
    en: "✓ {tool} installed ({version})",
  },
  envSaveFailed: {
    ru: "Не удалось сохранить переменные на сервере:\n{stderr}",
    en: "Failed to save the variables on the server:\n{stderr}",
  },
  stoppingPm2: {
    ru: "→ Останавливаю pm2-процесс «{name}»…",
    en: "→ Stopping pm2 process “{name}”…",
  },
  pm2Stopped: {
    ru: "✓ Процесс остановлен и убран из автозапуска",
    en: "✓ Process stopped and removed from autostart",
  },
  pm2NotFound: {
    ru: "  pm2-процесс не найден — пропускаю",
    en: "  pm2 process not found — skipping",
  },
  removingFiles: { ru: "→ Удаляю файлы проекта…", en: "→ Deleting project files…" },
  removingNginxConf: { ru: "→ Удаляю конфиг nginx…", en: "→ Deleting the nginx config…" },
  projectRemoved: {
    ru: "✓ Проект «{name}» удалён с сервера",
    en: "✓ Project “{name}” removed from the server",
  },
  configuringNginx: {
    ru: "→ Настраиваю nginx ({path})…",
    en: "→ Configuring nginx ({path})…",
  },
  nginxCheckFailed: {
    ru: "Конфигурация nginx не прошла проверку:\n{stderr}",
    en: "The nginx configuration failed validation:\n{stderr}",
  },
  nginxConfigured: {
    ru: "✓ nginx настроен и перезагружен",
    en: "✓ nginx configured and reloaded",
  },
  configuringHttps: {
    ru: "→ Настраиваю HTTPS для {domain}…",
    en: "→ Setting up HTTPS for {domain}…",
  },
  httpsConfigured: {
    ru: "✓ HTTPS настроен, сертификат будет продлеваться автоматически",
    en: "✓ HTTPS is set up, the certificate will renew automatically",
  },
  serverEnvVars: {
    ru: "✓ Переменные окружения с сервера: {count} шт.",
    en: "✓ Environment variables from the server: {count}",
  },
  building: { ru: "→ Собираю проект: {command}", en: "→ Building the project: {command}" },
  buildFailed: {
    ru: "Сборка не удалась ({command}):\n{output}",
    en: "The build failed ({command}):\n{output}",
  },
  installLocalFailed: {
    ru: "Не удалось установить зависимости ({command}):\n{output}",
    en: "Failed to install dependencies ({command}):\n{output}",
  },
  npmPeerConflict: {
    ru: "Не удалось установить зависимости: некоторые компоненты проекта конфликтуют друг с другом.\n{output}",
    en: "Failed to install dependencies: some components of the project conflict with each other.\n{output}",
  },
  installingDepsCompat: {
    ru: "→ Устанавливаю зависимости в режиме совместимости: npm install --legacy-peer-deps",
    en: "→ Installing dependencies in compatibility mode: npm install --legacy-peer-deps",
  },
  buildDirMissing: {
    ru: "После сборки не найдена папка «{dir}» в {projectDir}. Проверь buildDir в plantar.json.",
    en: "The “{dir}” folder was not found in {projectDir} after the build. Check buildDir in plantar.json.",
  },
  uploadingFiles: { ru: "→ Загружаю файлы…", en: "→ Uploading files…" },
  deployedFiles: {
    ru: "✓ Задеплоено файлов: {count} → {target}",
    en: "✓ Files deployed: {count} → {target}",
  },
  siteAvailable: { ru: "✓ Сайт доступен: {url}", en: "✓ The site is live: {url}" },
  domainConflict: {
    ru: "! Адрес {domain} уже занят другой настройкой веб-сервера ({file}) — она перекрывала бы этот сайт",
    en: "! The address {domain} is already taken by another web server configuration ({file}) — it would shadow this site",
  },
  checkingSiteUrl: {
    ru: "→ Проверяю, что сайт открывается: {url}",
    en: "→ Checking that the site opens: {url}",
  },
  siteCheckNoResponse: {
    ru: "! Деплой завершён, но сайт {url} пока не отвечает. Попробуйте открыть его через минуту-другую; если не поможет — посмотрите логи.",
    en: "! The deploy finished, but the site {url} is not responding yet. Try opening it in a minute or two; if that does not help, check the logs.",
  },
  siteCheckBadGateway: {
    ru: "! Деплой завершён, но сайт {url} пока не открывается (ответ {code}): веб-сервер не достучался до приложения. Попробуйте открыть сайт через минуту-другую; если не поможет — посмотрите логи.",
    en: "! The deploy finished, but the site {url} is not opening yet (response {code}): the web server could not reach the app. Try opening the site in a minute or two; if that does not help, check the logs.",
  },
  noFreePort: {
    ru: "Не нашлось свободного порта в диапазоне {from}–{to}.",
    en: "No free port found in the range {from}–{to}.",
  },
  checkingAppPort: {
    ru: "→ Проверяю, что приложение отвечает на порту {port}…",
    en: "→ Checking that the app responds on port {port}…",
  },
  appNotResponding: {
    ru: "Приложение не отвечает на порту {port}. Последние строки логов:\n{logs}",
    en: "The app is not responding on port {port}. Last log lines:\n{logs}",
  },
  appResponding: { ru: "✓ Приложение отвечает", en: "✓ The app responds" },
  requirementsMissing: {
    ru: "Не найден requirements.txt в {dir} — он нужен python-боту.",
    en: "requirements.txt was not found in {dir} — a python bot requires it.",
  },
  uploadedFiles: { ru: "✓ Загружено файлов: {count}", en: "✓ Files uploaded: {count}" },
  installingPythonDeps: {
    ru: "→ Создаю виртуальное окружение и ставлю зависимости: pip install -r requirements.txt",
    en: "→ Creating a virtual environment and installing dependencies: pip install -r requirements.txt",
  },
  installingDeps: {
    ru: "→ Устанавливаю зависимости: {packageManager} install",
    en: "→ Installing dependencies: {packageManager} install",
  },
  applyingServerEnv: {
    ru: "→ Подставляю переменные окружения с сервера…",
    en: "→ Applying environment variables from the server…",
  },
  emptyStartCommand: {
    ru: "Команда запуска пуста — укажите startCommand в plantar.json.",
    en: "The start command is empty — set startCommand in plantar.json.",
  },
  startingPm2: {
    ru: "→ Запускаю через pm2: {command}",
    en: "→ Starting via pm2: {command}",
  },
  portAssigned: {
    ru: "✓ Приложению назначен порт {port}",
    en: "✓ The app was assigned port {port}",
  },
  appAvailable: { ru: "✓ Приложение доступно: {url}", en: "✓ The app is live: {url}" },
  checkingProcess: {
    ru: "→ Проверяю, что процесс работает…",
    en: "→ Checking that the process is running…",
  },
  processUnstable: {
    ru: "Процесс «{name}» не запустился или падает сразу после старта. Последние строки логов:\n{logs}",
    en: "Process “{name}” did not start or crashes right after starting. Last log lines:\n{logs}",
  },
  processStable: {
    ru: "✓ Процесс работает стабильно",
    en: "✓ The process is running steadily",
  },
  botDeployed: {
    ru: "✓ Бот запущен. pm2 перезапустит его после падения и после перезагрузки сервера.",
    en: "✓ The bot is running. pm2 will restart it after a crash and after a server reboot.",
  },
  takeoverStoppingOld: {
    ru: "→ Останавливаю прежний процесс «{name}» — приложение переходит под управление Plantar…",
    en: "→ Stopping the previous process “{name}” — the app is moving under Plantar management…",
  },
  takeoverOldStopped: {
    ru: "✓ Прежний процесс остановлен и убран из автозапуска",
    en: "✓ The previous process was stopped and removed from autostart",
  },
  takeoverDisablingNginx: {
    ru: "→ Отключаю прежний конфиг nginx ({file})…",
    en: "→ Disabling the previous nginx config ({file})…",
  },
  takeoverNginxManual: {
    ru: "! Прежний конфиг nginx ({file}) лежит вне sites-enabled — Plantar его не трогает. Если сайт отвечает неправильно, отключите этот конфиг вручную.",
    en: "! The previous nginx config ({file}) is outside sites-enabled — Plantar leaves it untouched. If the site responds incorrectly, disable that config manually.",
  },
  rollbackNotManaged: {
    ru: "На сервере пока нет сохранённых версий этого приложения — они появятся после следующего деплоя через Plantar.",
    en: "The server has no saved versions of this app yet — they will appear after the next deploy via Plantar.",
  },
  rollbackNoPrevious: {
    ru: "Предыдущей версии нет: на сервере сохранена только одна версия приложения.",
    en: "There is no previous version: the server has only one saved version of the app.",
  },
  rollbackNoEcosystem: {
    ru: "В сохранённой версии {release} нет файла запуска — вернуться к ней не получится.",
    en: "The saved version {release} has no start file — it cannot be restored.",
  },
  rollbackStarting: {
    ru: "→ Возвращаю предыдущую версию ({release})…",
    en: "→ Restoring the previous version ({release})…",
  },
  rollbackDone: {
    ru: "✓ Возвращена версия {release}",
    en: "✓ Version {release} restored",
  },
  goaccessMissing: {
    ru: "На сервере не установлен инструмент статистики посещений (GoAccess).",
    en: "The visit statistics tool (GoAccess) is not installed on the server.",
  },
  netdataNotResponding: {
    ru: "Служба мониторинга нагрузки (Netdata) не отвечает на сервере.",
    en: "The load monitoring service (Netdata) is not responding on the server.",
  },
  appMetricsInstalling: {
    ru: "→ Настраиваю сбор нагрузки приложений…",
    en: "→ Setting up app load collection…",
  },
  appMetricsEnabled: {
    ru: "✓ Сбор нагрузки приложений включён",
    en: "✓ App load collection is enabled",
  },
} satisfies Messages<string>;

export const t = createT(MESSAGES);
