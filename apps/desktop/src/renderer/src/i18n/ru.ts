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

  "sidebar.servers": "Серверы",
  "sidebar.addServer": "Добавить сервер",
  "sidebar.empty":
    "Пока пусто. Добавь первый сервер — понадобятся IP и пароль от хостинга.",
  "sidebar.addProject": "Добавить проект",
  "sidebar.removeServer": "Удалить сервер",
  "sidebar.removeProject": "Убрать проект из списка",
  "sidebar.settings": "Настройки",

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

  "env.banner":
    "Переменные хранятся на сервере и применяются при следующем деплое: для React-сайтов — при сборке, для Node.js и ботов файл .env кладётся рядом с приложением. Локальные .env-файлы из папки проекта на сервер не загружаются.",
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
} as const;

export type MessageKey = keyof typeof ru;
