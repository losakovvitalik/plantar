/**
 * Русский словарь — эталон ключей: типы всех словарей выводятся из него.
 * Все пользовательские строки интерфейса живут здесь и в en.ts,
 * в компонентах — только t("ключ"). Подстановки — {имя}.
 */
export const ru = {
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.saving": "Сохраняю…",
  "common.close": "Закрыть",
  "common.connect": "Подключиться",
  "common.connecting": "Подключаюсь…",
  "common.back": "Назад",
  "common.next": "Далее",
  "common.loading": "Загружаю…",

  "app.unexpectedError": "Непредвиденная ошибка: {message}",
  "app.settingsFromConfig": "Настройки взяты из plantar.json в папке проекта.",
  "app.frameworkDetected": "Определён фреймворк: {framework}. ",
  "app.settingsAutoDetected": "Настройки определены автоматически. ",
  "app.checkAndAdd": "Проверьте внимательно значения и добавьте проект.",
  "app.confirmRemoveServer": "Удалить сервер «{name}» и его проекты из списка?",
  "app.tabDeploy": "Деплой",
  "app.tabEnv": "Переменные",
  "app.tabStatus": "Статус",
  "app.tabLogs": "Логи",
  "app.tabHistory": "История",
  "app.tabCommits": "Коммиты",
  "app.projectSettings": "Настройки проекта",
  "app.serverHint": "Сервер. Добавь проект через «+» в списке слева, чтобы деплоить.",
  "app.emptyAddServer": "Добавь первый сервер",
  "app.emptySelect": "Выбери сервер или проект",
  "app.emptyAddServerHint":
    "Понадобятся IP-адрес и пароль — их выдаёт хостинг. Дальше Plantar настроит всё сам.",
  "app.emptySelectHint": "Слева — твои серверы и проекты на них.",
  "app.settingsSaved":
    "Настройки сохранены. Они применятся к приложению при следующем деплое.",
  "app.newProject": "Новый проект",
  "app.addProject": "Добавить проект",
  "app.discoverApps": "Найти приложения",
  "app.externalBadge": "Внешний",
  "app.externalBadgeHint":
    "Приложение работало на сервере до Plantar. Возврат предыдущей версии станет доступен после первого деплоя через Plantar.",

  "sidebar.servers": "Серверы",
  "sidebar.addServer": "Добавить сервер",
  "sidebar.empty":
    "Пока пусто. Добавь первый сервер — понадобятся IP и пароль от хостинга.",
  "sidebar.addProject": "Добавить проект",
  "sidebar.removeServer": "Удалить сервер",
  "sidebar.removeProject": "Убрать проект из списка",
  "sidebar.settings": "Настройки",
  "sidebar.status.refresh": "Проверить статусы приложений",
  "sidebar.status.running": "Работает",
  "sidebar.status.stopped": "Не запущено",
  "sidebar.status.error": "Ошибка — приложение не работает",
  "sidebar.status.unknown": "Статус неизвестен",
  "sidebar.status.checking": "Проверка…",
  "sidebar.status.server.checking": "Проверка…",
  "sidebar.status.server.ok": "Сервер доступен",
  "sidebar.status.server.unreachable": "Нет связи с сервером",
  "sidebar.status.server.needsPassword": "Статус неизвестен — нужен пароль",
  "sidebar.status.checkedAt": "проверено {time}",

  "addServer.title": "Добавить сервер",
  "addServer.description":
    "Понадобятся адрес сервера и данные для входа — их выдаёт хостинг.",
  "addServer.host": "Адрес (IP)",
  "addServer.port": "Порт",
  "addServer.user": "Пользователь",
  "addServer.name": "Название (необязательно)",
  "addServer.namePlaceholder": "Мой сервер",
  "addServer.authMethod": "Способ входа",
  "addServer.keyTitle": "SSH-ключ",
  "addServer.keyDescription":
    "Plantar создаст ключ и настроит его на сервере сам. Рекомендуем.",
  "addServer.passwordTitle": "Пароль",
  "addServer.passwordDescription":
    "Без ключа. Пароль будет запрашиваться при каждом подключении.",
  "addServer.keyNote":
    "Пароль нужен один раз — чтобы установить ключ на сервер. Plantar его не сохраняет.",
  "addServer.passwordNote":
    "Пароль нигде не сохраняется. Его придётся вводить при каждом подключении к серверу.",
  "addServer.serverPasswordOnce": "Пароль сервера (нужен один раз)",
  "addServer.serverPassword": "Пароль сервера",
  "addServer.submit": "Добавить сервер",

  "deploy.running": "Деплою…",
  "deploy.start": "Задеплоить",
  "deploy.viaIp": "по IP",
  "deploy.noDomain": ", без домена",
  "deploy.showCommands": "Показывать команды",
  "deploy.deployedAt": "Приложение задеплоено: {url}",
  "deploy.botDeployed": "Бот задеплоен и запущен.",
  "deploy.terminalEmpty": "Здесь будет виден каждый шаг деплоя.",
  "deploy.showMoreError": "Показать ещё",
  "deploy.hideError": "Скрыть",
  "deploy.copyError": "Копировать",
  "deploy.errorCopied": "Скопировано",
  "deploy.updateAndDeploy": "Обновить и задеплоить",
  "deploy.notDeployedYet": "Ещё не деплоился",
  "deploy.rollback": "Вернуть предыдущую версию",
  "deploy.rollingBack": "Возвращаю…",
  "deploy.rollbackConfirm":
    "Вернуть предыдущую версию приложения на сервере? Текущая версия будет остановлена.",
  "deploy.rollbackExternalHint":
    "Возврат предыдущей версии станет доступен после первого деплоя через Plantar.",
  "deploy.rolledBackAt": "Предыдущая версия возвращена: {url}",
  "deploy.rolledBackDone": "Предыдущая версия возвращена.",
  "deploy.externalHint":
    "Приложение импортировано с сервера. Логи и переменные уже работают, а после первого деплоя Plantar начнёт хранить версии — станет доступен возврат предыдущей версии.",
  "deploy.externalNeedsFolder":
    "Чтобы деплоить это приложение, укажите папку с его кодом на этом компьютере.",
  "deploy.externalRepoBefore": "Приложение задеплоено из репозитория",
  "deploy.externalRepoAfter":
    ". Подключите его — обновления будут скачиваться из GitHub при каждом деплое.",
  "deploy.connectRepo": "Подключить репозиторий",
  "deploy.connectingRepo": "Подключаю…",
  "deploy.pickFolder": "Указать папку с кодом",

  "discover.title": "Найдено на сервере",
  "discover.description":
    "Приложения, запущенные на сервере «{server}», которых ещё нет в Plantar.",
  "discover.hint":
    "Проект добавится как внешний: логи и переменные заработают сразу, а возврат предыдущей версии появится после первого деплоя через Plantar.",
  "discover.scanning": "Ищу запущенные приложения на сервере…",
  "discover.empty":
    "Новых приложений не нашлось: всё, что запущено на сервере, уже есть в списке, либо на сервере нет приложений, запущенных через pm2.",
  "discover.retry": "Поискать ещё раз",
  "discover.statusOnline": "работает",
  "discover.statusStopped": "остановлено",
  "discover.serverFolder": "Папка на сервере",
  "discover.repo": "Репозиторий",
  "discover.add": "Добавить",
  "discover.adding": "Добавляю…",
  "discover.added": "Добавлен",

  "commits.loading": "Загружаю коммиты…",
  "commits.empty": "Коммитов пока нет.",
  "commits.branchHint": "Ветка {branch}",
  "commits.refresh": "Обновить",
  "commits.badge.onServer": "На сервере",
  "commits.badge.deployed": "Задеплоен",
  "commits.badge.failed": "Деплой упал",
  "commits.badge.notDeployed": "Не деплоился",

  "ciSetup.button": "Настроить деплой при коммите",
  "ciSetup.title": "Деплой при коммите",
  "ciSetup.description":
    "Каждый новый коммит в ветке {branch} будет автоматически деплоиться на сервер «{server}» — даже когда Plantar закрыт.",
  "ciSetup.will1":
    "Будет создан отдельный ключ доступа для GitHub — личный ключ останется только на этом компьютере.",
  "ciSetup.will2":
    "Ключ и адрес сервера сохранятся в защищённом хранилище репозитория (GitHub Secrets).",
  "ciSetup.will3":
    "В ветку {branch} будет добавлен коммит с файлом автодеплоя и настройками проекта (plantar.json).",
  "ciSetup.secretsNote":
    "Данные для подключения к серверу будут храниться не только на этом компьютере, но и на GitHub — без этого GitHub не сможет деплоить самостоятельно.",
  "ciSetup.loginNeeded": "Чтобы настроить деплой при коммите, войдите в GitHub.",
  "ciSetup.reloginNeeded":
    "Нужно ещё одно разрешение GitHub — на изменение файлов автоматизации в репозитории. Войдите заново, чтобы выдать его.",
  "ciSetup.login": "Войти через GitHub",
  "ciSetup.relogin": "Войти заново",
  "ciSetup.submit": "Настроить",
  "ciSetup.working": "Настройка…",
  "ciSetup.done":
    "Готово. Теперь каждый коммит в ветке {branch} будет автоматически деплоиться на сервер.",
  "ciSetup.doneHistoryNote":
    "Такие деплои запускает GitHub, поэтому в историю и статусы коммитов в приложении они пока не попадают — следить за ними можно на странице Actions.",
  "ciSetup.openActions": "Открыть Actions на GitHub",

  "addProjectDialog.title": "Новый проект",
  "addProjectDialog.description": "Откуда взять код проекта?",
  "addProjectDialog.gitDescription": "Вставьте ссылку на репозиторий GitHub.",
  "addProjectDialog.localTitle": "Папка на компьютере",
  "addProjectDialog.localHint": "Выбрать папку с проектом на этом компьютере.",
  "addProjectDialog.gitTitle": "Репозиторий GitHub",
  "addProjectDialog.gitHint": "Скачать проект по ссылке на репозиторий.",
  "addProjectDialog.repoUrl": "Ссылка на репозиторий",
  "addProjectDialog.privateHint":
    "Для приватных репозиториев сначала войдите в GitHub в настройках.",
  "addProjectDialog.branch": "Ветка",
  "addProjectDialog.clone": "Скачать и продолжить",
  "addProjectDialog.cloning": "Скачиваю…",

  "github.loginTitle": "Вход через GitHub",
  "github.loginDescription": "Подтвердите вход на сайте GitHub.",
  "github.enterCode": "Введите этот код на открывшейся странице GitHub:",
  "github.openGithub": "Открыть GitHub ещё раз",
  "github.waiting": "Ожидаю подтверждения…",

  "env.banner":
    "Переменные хранятся на сервере и применяются при следующем деплое: для React и Next.js — при сборке, для Node.js и ботов файл .env кладётся рядом с приложением. NODE_ENV Plantar задаёт автоматически — добавлять её сюда не нужно. Локальные .env-файлы из папки проекта на сервер не загружаются.",
  "env.confirmDiscard": "Несохранённые изменения будут потеряны. Продолжить?",
  "env.loading": "Загрузка переменных с сервера…",
  "env.load": "Загрузить переменные",
  "env.passwordNeeded": "Понадобится пароль сервера.",
  "env.emptyTitle": "Переменных пока нет",
  "env.emptyHint":
    "Переменные окружения — например, адрес API или токен бота — хранятся на сервере и применяются при деплое.",
  "env.importHint":
    "В папке проекта найдены локальные файлы — можно импортировать переменные:",
  "env.refreshTitle": "Перечитать переменные с сервера",
  "env.refresh": "Обновить",
  "env.hideAll": "Скрыть все",
  "env.showAll": "Показать все",
  "env.keyPlaceholder": "ИМЯ_ПЕРЕМЕННОЙ",
  "env.valuePlaceholder": "значение",
  "env.hideValue": "Скрыть значение",
  "env.showValue": "Показать значение",
  "env.removeVar": "Удалить переменную",
  "env.addVar": "Добавить переменную",
  "env.savedFlash": "Сохранено ✓ — применится при следующем деплое",
  "env.unsaved": "не сохранено",
  "env.noVarsInFile": "В файле {file} нет переменных.",

  "history.loadLogError": "Не удалось открыть лог: {error}",
  "history.readingLog": "Читаю лог…",
  "history.loading": "Загрузка истории…",
  "history.emptyTitle": "Пока ни одного деплоя",
  "history.emptyHint":
    "Здесь появится каждая попытка деплоя этого проекта — со статусом, временем и полным логом.",
  "history.duration": "за {duration}",
  "history.seconds": "{seconds} с",
  "history.minutesSeconds": "{minutes} мин {seconds} с",
  "history.openSite": "Открыть сайт",
  "history.rollback": "Возврат версии",

  "logs.sourceApp": "Приложение",
  "logs.channelOutput": "Вывод",
  "logs.channelErrors": "Ошибки",
  "logs.channelRequests": "Запросы",
  "logs.filterAll": "Всё",
  "logs.resume": "Продолжить",
  "logs.pause": "Пауза",
  "logs.clear": "Очистить",
  "logs.connectHint":
    "Живые логи с сервера — без терминала. Понадобится пароль сервера.",
  "logs.reconnect": "Переподключиться",
  "logs.disconnected": "Соединение с сервером прервалось.",
  "logs.streamConnected": "Поток подключён — новые записи появятся здесь.",
  "logs.terminalEmpty": "Здесь будут логи в реальном времени.",
  "logs.statusPaused": "на паузе",
  "logs.statusLive": "в эфире",
  "logs.statusConnecting": "подключение…",
  "logs.statusEnded": "прервано",
  "logs.statusIdle": "не подключено",

  "password.title": "Пароль для «{name}»",
  "password.description":
    "Этот сервер добавлен без ключа, поэтому пароль нужен при каждом подключении.",

  "projectSettings.typeStaticLabel": "React",
  "projectSettings.typeStaticHint": "Статический сайт: React, Vite и другие",
  "projectSettings.typeNodeLabel": "Node.js",
  "projectSettings.typeNodeHint": "Серверное приложение: Express и другие",
  "projectSettings.typeNextLabel": "Next.js",
  "projectSettings.typeNextHint": "Next.js с серверной сборкой и запуском",
  "projectSettings.typeBotLabel": "Telegram-бот",
  "projectSettings.typeBotHint": "Бот на long polling: grammY, aiogram и другие",
  "projectSettings.nameError":
    "Название: только строчные латинские буквы, цифры и дефис.",
  "projectSettings.portError": "Порт: целое число от 1 до 65535.",
  "projectSettings.type": "Тип проекта",
  "projectSettings.name": "Название",
  "projectSettings.nameHint":
    "Строчные латинские буквы, цифры и дефис. Так будет называться папка сайта на сервере.",
  "projectSettings.domain": "Домен",
  "projectSettings.domainPlaceholder": "app.mysite.ru",
  "projectSettings.domainHint":
    "С доменом сайт получит HTTPS-сертификат автоматически. Если оставить пустым, сайт будет открываться по IP сервера.",
  "projectSettings.runtime": "Рантайм",
  "projectSettings.packageManager": "Менеджер пакетов",
  "projectSettings.buildDir": "Папка сборки",
  "projectSettings.port": "Порт",
  "projectSettings.portPlaceholder": "автоматически",
  "projectSettings.buildCommand": "Команда сборки",
  "projectSettings.buildCommandHint":
    "Выполняется в папке проекта перед деплоем. Сюда можно вписать любую команду и флаги, например",
  "projectSettings.startCommand": "Команда запуска",
  "projectSettings.botStartHint":
    "Так бот запускается на сервере (через pm2). Токен и другие секреты задаются на вкладке «Переменные».",
  "projectSettings.nodeStartHintBefore":
    "Так приложение запускается на сервере (через pm2). Порт передаётся приложению в переменной",
  "projectSettings.nodeStartHintAfter":
    "; если поле «Порт» пустое, свободный порт подберётся при первом деплое.",
  "projectSettings.deploy": "Деплой",
  "projectSettings.subdir": "Папка проекта в репозитории",
  "projectSettings.subdirRoot": "Корень репозитория",
  "projectSettings.subdirPick": "Выбрать папку",
  "projectSettings.subdirHint":
    "Укажите папку, если проект лежит не в корне репозитория (например, в монорепозитории). По умолчанию — корень.",
  "projectSettings.branch": "Ветка",
  "projectSettings.branchChange": "Сменить",
  "projectSettings.branchHint":
    "Деплой идёт из выбранной ветки. Если настроен деплой при коммите, после смены ветки настройте его заново.",

  "removeProject.title": "Удалить проект «{name}»?",
  "removeProject.description":
    "Локальная папка проекта в любом случае останется на месте.",
  "removeProject.fromList": "Убрать из списка",
  "removeProject.fromListHint":
    " — проект исчезнет из Plantar, но продолжит работать на сервере.",
  "removeProject.fromServer": "Удалить с сервера",
  "removeProject.fromServerHint":
    " — остановит процесс, уберёт его из автозапуска и удалит файлы проекта с сервера (у сайтов — и конфиг nginx).",
  "removeProject.removing": "Удаляю…",

  "status.checking": "Проверяю…",
  "status.check": "Проверить сервер",
  "status.supported": "поддерживается",
  "status.unsupported": "не поддерживается",
  "status.cpu": "CPU: {count}",
  "status.ram": "RAM: {mb} МБ",
  "status.disk": "Диск: {gb} ГБ свободно",
  "status.tools": "Инструменты",
  "status.notInstalled": "не установлен",

  "settings.title": "Настройки",
  "settings.description": "Глобальные настройки Plantar",
  "settings.language": "Язык интерфейса",
  "settings.logCopies": "Хранить копии серверных логов",
  "settings.logCopiesHint":
    "При каждом просмотре логов последняя версия сохраняется на этот компьютер — они останутся доступны, даже если сервер перестанет отвечать.",
  "settings.notifySuccess": "Уведомлять об успешных деплоях",
  "settings.notifySuccessHint":
    "Системное уведомление, когда деплой завершился успешно. Об ошибках уведомления приходят всегда.",
  "settings.leEmail": "Email для SSL-сертификатов",
  "settings.leEmailHint":
    "Let's Encrypt пришлёт письмо, если с автопродлением сертификата что-то пойдёт не так. Применяется при следующем деплое с доменом. Можно оставить пустым.",

  "settings.github": "Аккаунт GitHub",
  "settings.githubHint": "Войдите, чтобы деплоить приватные репозитории по ссылке.",
  "settings.githubConnected": "Подключён аккаунт @{login}.",
  "settings.githubConnect": "Войти через GitHub",
  "settings.githubSignOut": "Выйти",
} as const;

export type MessageKey = keyof typeof ru;
