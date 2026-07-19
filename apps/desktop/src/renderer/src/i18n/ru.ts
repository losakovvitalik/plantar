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
  "app.tabFiles": "Файлы",
  "app.tabHistory": "История",
  "app.tabCommits": "Коммиты",
  "app.projectSettings": "Настройки проекта",
  "app.serverHint": "Сервер. Добавь проект через «+» в списке слева, чтобы деплоить.",
  "app.monitoringPasswordHint":
    "Фоновая проверка приложений для этого сервера недоступна: он подключается по паролю, а пароль не сохраняется.",
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
  "sidebar.search.placeholder": "Поиск",
  "sidebar.search.empty": "Ничего не найдено",
  "sidebar.collapseProjects": "Свернуть проекты",
  "sidebar.expandProjects": "Развернуть проекты",
  "sidebar.removeServer": "Удалить сервер",
  "sidebar.removeProject": "Убрать проект из списка",
  "sidebar.settings": "Настройки",
  "sidebar.status.refresh": "Проверить статусы приложений",
  "sidebar.status.running": "Работает",
  "sidebar.status.stopped": "Не запущено",
  "sidebar.status.error": "Ошибка — приложение не работает",
  "sidebar.status.unresponsive": "Сайт не отвечает",
  "sidebar.status.unknown": "Статус неизвестен",
  "sidebar.status.checking": "Проверка…",
  "sidebar.status.server.checking": "Проверка…",
  "sidebar.status.server.ok": "Сервер доступен",
  "sidebar.status.server.unreachable": "Нет связи с сервером",
  "sidebar.status.server.needsPassword": "Статус неизвестен — нужен пароль",
  "sidebar.status.checkedAt": "проверено {time}",
  "sidebar.deploying.deploy": "Идёт деплой",
  "sidebar.deploying.rollback": "Идёт возврат предыдущей версии",

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
  "addServer.fromSshConfig": "Найдено в настройках SSH на этом компьютере",
  "addServer.existingKeyTitle": "Ключ уже настроен",
  "addServer.existingKeyDescription":
    "Вход по SSH-ключу уже работает — останется указать файл ключа.",
  "addServer.existingKeyNote":
    "Для хостингов, которые не выдают пароль: ключ добавлен через панель хостинга, и Plantar будет входить по нему. Пароль не понадобится.",
  "addServer.keyFile": "Файл ключа",
  "addServer.pickKeyFile": "Выбрать файл…",
  "addServer.noKeysFound":
    "Готовые ключи на этом компьютере не нашлись — укажите файл ключа вручную.",
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
  "deploy.peerConflictHint":
    "Вы можете исправить версии в самом проекте. Либо установите зависимости в режиме совместимости — после успешного деплоя он сохранится и для следующих деплоев.",
  "deploy.compatRetry": "Попробовать режим совместимости",
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
  "deploy.lastRunDeploy": "Деплой от {when}",
  "deploy.lastRunRollback": "Возврат версии от {when}",
  "deploy.lastRunSuccess": "Успешно",
  "deploy.lastRunError": "С ошибкой",
  "deploy.lastRunInterrupted": "Был прерван",

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
  "discover.envFiles": "Файлы с переменными",
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

  "files.loading": "Загружаю список файлов…",
  "files.load": "Показать файлы",
  "files.passwordNeeded": "Понадобится пароль сервера.",
  "files.refresh": "Обновить",
  "files.refreshTitle": "Перечитать файлы с сервера",
  "files.emptyDir": "Папка пуста",
  "files.linkBadge": "ссылка",
  "files.relatedTitle": "Связанные файлы",
  "files.relatedConf": "Настройки веб-сервера",
  "files.relatedAccess": "Журнал запросов",
  "files.relatedError": "Журнал ошибок",
  "files.relatedMissing": "файла пока нет",
  "files.viewerPlaceholder": "Выберите файл слева, чтобы посмотреть его содержимое.",
  "files.viewerLoading": "Открываю файл…",
  "files.emptyFile": "Файл пуст.",
  "files.binaryNotice": "Это не текстовый файл ({size}) — показать его содержимое нельзя.",
  "files.truncatedNotice": "Файл большой ({size}) — показан его конец.",
  "files.sizeB": "{value} Б",
  "files.sizeKb": "{value} КБ",
  "files.sizeMb": "{value} МБ",
  "files.sizeGb": "{value} ГБ",

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

  "appStatus.check": "Проверить",
  "appStatus.checking": "Проверяю…",
  "appStatus.processTitle": "Работа приложения",
  "appStatus.state.running": "Работает",
  "appStatus.state.stopped": "Остановлено",
  "appStatus.state.errored": "Ошибка",
  "appStatus.noProcess":
    "Приложение на сервере не найдено. Оно появится после первого деплоя.",
  "appStatus.staticNote":
    "Сайт раздаётся сервером как готовые файлы — отдельного процесса и нагрузки у него нет.",
  "appStatus.since": "Работает с",
  "appStatus.restarts": "Перезапуски",
  "appStatus.restartsHint":
    "Частые перезапуски — признак того, что приложение падает и запускается снова. Загляните в логи.",
  "appStatus.memory": "Память",
  "appStatus.cpu": "Процессор",
  "appStatus.mb": "{mb} МБ",
  "appStatus.trafficTitle": "Посещаемость",
  "appStatus.trafficHint": "По журналу сервера — примерно за две последние недели",
  "appStatus.requests": "Запросы",
  "appStatus.visitors": "Посетители",
  "appStatus.errors": "Ошибки приложения",
  "appStatus.byDay": "По дням",
  "appStatus.byHour": "По времени суток",
  "appStatus.topPaths": "Популярные страницы",
  "appStatus.trafficEmpty":
    "Записей о посещениях пока нет. Они появятся, когда сайт начнут открывать.",
  "appStatus.trafficNoLog":
    "У приложения пока нет собственного журнала посещений, поэтому заходы на сайт здесь не видны. Журнал появится после первого деплоя через Plantar.",
  "appStatus.needGoaccess":
    "Чтобы видеть посещаемость, установите инструмент «Статистика посещений» на экране сервера.",
  "appStatus.openServer": "Открыть экран сервера",
  "appStatus.loadTitle": "Нагрузка приложения",
  "appStatus.loadNeedSetup":
    "Подключите сбор нагрузки — здесь появится история за час и за сутки: сколько процессора и памяти использует приложение и как активно оно пишет в логи.",
  "appStatus.loadEnable": "Подключить графики",
  "appStatus.loadCollecting":
    "Данные собираются. Первые точки появятся через минуту-другую.",
  "appStatus.loadCpuHint": "100% — одно ядро процессора",
  "appStatus.logsTitle": "Логи за сутки",
  "appStatus.logsHint": "Каждый столбик — один час",
  "appStatus.logsEmpty": "За последние сутки записей в логах не было.",

  "monitoring.title": "Мониторинг",
  "monitoring.description":
    "Дополнительные инструменты. Они устанавливаются на сервер и расходуют его ресурсы, поэтому включаются по желанию.",
  "monitoring.check": "Проверить",
  "monitoring.goaccessName": "Статистика посещений (GoAccess)",
  "monitoring.goaccessDescription":
    "Считает посещаемость по журналам сервера — графики на вкладке «Статус» каждого приложения. Работает только в момент проверки и почти не расходует ресурсы.",
  "monitoring.netdataName": "Нагрузка сервера (Netdata)",
  "monitoring.netdataDescription":
    "Круглосуточно записывает нагрузку на процессор и память — график появится на этой странице. Постоянно работает в фоне и занимает примерно 30–100 МБ памяти сервера.",
  "monitoring.install": "Установить",
  "monitoring.installing": "Устанавливаю…",
  "monitoring.installed": "Установлен",
  "monitoring.start": "Запустить",
  "monitoring.loadTitle": "Нагрузка сервера",
  "monitoring.hour": "Час",
  "monitoring.day": "Сутки",
  "monitoring.cpuChart": "Процессор, %",
  "monitoring.cpuSeries": "Загрузка",
  "monitoring.ramChart": "Память, МБ",
  "monitoring.ramSeries": "Занято",
  "monitoring.ramSummary": "Занято {used} из {total} МБ",
  "monitoring.otherSeries": "Другое",
  "monitoring.breakdownHint":
    "«Другое» — всё остальное на сервере: система, службы и сайты из статических файлов.",
  "monitoring.diskChart": "Диск, ГБ",
  "monitoring.diskSeries": "Занято",
  "monitoring.diskSummary": "Занято {used} из {total} ГБ",
  "monitoring.gb": "{gb} ГБ",
  "monitoring.appMetricsName": "Нагрузка приложений",
  "monitoring.appMetricsDescription":
    "История потребления процессора и памяти по каждому приложению — графики на вкладке «Статус». Использует Netdata; данные снимаются раз в минуту.",

  "appMetrics.dialogTitle": "Подключить графики нагрузки?",
  "appMetrics.dialogDescription":
    "Сбор истории расходует ресурсы сервера, поэтому подключается только вручную.",
  "appMetrics.dialogBody":
    "На сервер будет установлена бесплатная программа Netdata — она ведёт историю нагрузки. Раз в минуту будет записываться, сколько процессора и памяти использует каждое приложение и сколько записей появляется в его логах.",
  "appMetrics.dialogCost":
    "Netdata занимает примерно 30–100 МБ памяти сервера. Если она уже установлена, добавится только сбор данных по приложениям.",
  "appMetrics.enable": "Подключить",
  "appMetrics.enabling": "Подключаю…",
  "appMetrics.enabled": "Подключено",

  "settings.title": "Настройки",
  "settings.description": "Глобальные настройки Plantar",
  "settings.language": "Язык интерфейса",
  "settings.logCopies": "Хранить копии серверных логов",
  "settings.logCopiesHint":
    "При каждом просмотре логов последняя версия сохраняется на этот компьютер — они останутся доступны, даже если сервер перестанет отвечать.",
  "settings.notifySuccess": "Уведомлять об успешных деплоях",
  "settings.notifySuccessHint":
    "Системное уведомление, когда деплой завершился успешно. Об ошибках уведомления приходят всегда.",
  "settings.notifyAppDown": "Следить за приложениями в фоне",
  "settings.notifyAppDownHint":
    "Plantar каждые 5 минут проверяет приложения на серверах и присылает уведомление, если какое-то перестало работать — и когда оно снова заработало. Серверы, подключаемые по паролю, в фоне не проверяются.",
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
