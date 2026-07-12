# Функции проекта

Краткое описание основных функций проекта и какие файлы за них отвечают.

Plantar — local-first инструмент деплоя приложений на Ubuntu-серверы (22.04/24.04) для не-программистов. Две оболочки — desktop GUI (`apps/desktop`, Electron + React) и CLI (`apps/cli`) — используют общую логику из пакетов:

| Пакет | Назначение |
| --- | --- |
| `packages/ssh` | SSH-соединение (ssh2): exec, стриминг вывода, загрузка директорий tar-архивом, `shellQuote` |
| `packages/core` | Вся deploy-логика: проверка и подготовка сервера, деплой, env, логи, удаление |
| `packages/config` | Схема `plantar.json` (zod), чтение/запись, автоопределение типа проекта |
| `packages/storage` | Локальные данные: серверы, проекты, история, настройки, логи, ключи |

## SSH-подключение

`packages/ssh/src/index.ts` — класс `SshConnection`: `exec` (команда → stdout/stderr/код), `execStream` (живой вывод с остановкой), `uploadDirectory` (пакует папку в tar.gz, загружает одним файлом по SFTP и распаковывает на сервере; поддерживает исключения), `listDirectories`. Keepalive раз в 15 секунд.

- Пул соединений (desktop): `apps/desktop/src/main/ssh-pool.ts` — живое соединение переиспользуется между операциями, закрывается после 2 минут простоя. Пока соединение живо, пароль повторно не запрашивается (`isConnected`).

## Серверы и авторизация

- Добавление сервера: `apps/desktop/src/main/index.ts` (`addServer`) + `apps/desktop/src/renderer/src/components/add-server-dialog.tsx`. Два режима: по ключу и по паролю.
- Режим «ключ»: `apps/desktop/src/main/ssh-setup.ts` — генерирует пару ed25519 (`ssh-keygen`), по паролю устанавливает публичный ключ в `authorized_keys`, проверяет вход по ключу и только потом сохраняет сервер. Приватный ключ шифруется системным keychain (`safeStorage`), fallback — файл 0600; есть разовая миграция старых незашифрованных ключей.
- Режим «пароль»: пароль не сохраняется, запрашивается диалогом при каждом новом подключении (`password-dialog.tsx`).

## Проверка сервера

`getServerInfo` в `packages/core/src/index.ts` — ОС (поддерживается ли), CPU, RAM, свободный диск, версии инструментов (node, pnpm, pm2, nginx, certbot, python+venv). UI: `status-tab.tsx`.

## Подготовка сервера

`setupServer` в `packages/core/src/index.ts` — устанавливает недостающее: Node.js 22 (NodeSource), pnpm, pm2, nginx, certbot, python3+venv+pip. Идемпотентна: установленное пропускает. В GUI пока не выведена — доступна через CLI `setup`.

## Проекты и plantar.json

`packages/config/src/index.ts`:

- Схема конфига: `name`, `type` (static | node | next | bot), `runtime` (node | python), `packageManager`, `buildCommand`, `buildDir`, `startCommand`, `port`, `domain`. Regex на `name` и `domain` заодно защищают от shell-инъекций.
- `detectProjectConfig` — автоопределение по файлам проекта: пакетный менеджер по lockfile, фреймворк (Vite, CRA, Next.js, Express/Fastify/NestJS/…, grammY/Telegraf, aiogram/python-telegram-bot), тип проекта и команды сборки/запуска.
- Добавление проекта в GUI: выбор папки → предзаполненная форма настроек → создание `plantar.json` (`apps/desktop/src/main/index.ts`: `pickProjectFolder`, `addProject`; UI `project-settings-dialog.tsx`). Имя проекта проверяется на уникальность в пределах сервера.
- Настройки проекта редактируются в том же диалоге; после сохранения предлагается деплой в один клик (`app.tsx`).

## Деплой

`deployProject` в `packages/core/src/index.ts`, три сценария по `type`:

- **static** — локальная сборка (`buildCommand`, env-переменные с сервера подставляются в окружение сборки), загрузка в staging-папку и публикация как новой версии; nginx раздаёт статику из `current` (без домена — default_server по IP).
- **node** — загрузка кода (без node_modules, .git, .env), установка зависимостей на сервере, запуск через pm2 (ecosystem-конфиг, автозапуск после перезагрузки), автоподбор свободного порта 3001–3999 с закреплением в `plantar.json`, проверка что приложение отвечает по HTTP, nginx как reverse proxy.
- **next** — как node, но после установки зависимостей выполняется серверная сборка `buildCommand`; старая версия остаётся рабочей, если сборка падает. Переменные проекта копируются в `.env` до сборки, затем приложение запускается через pm2 и проксируется nginx.
- **bot** (Telegram-бот, runtime node или python) — то же без nginx и порта; для python — venv + `pip install -r requirements.txt`; проверка что pm2-процесс стабильно живёт.

Структура на сервере: каждая версия деплоится в `/var/www/<name>/releases/<метка времени>`, симлинк `/var/www/<name>/current` указывает на рабочую версию (хранится 5 последних, `finalizeRelease`/`switchCurrent`/`pruneReleases` в core). Прежняя плоская структура `/var/www/<name>` заменяется управляемой при первом же деплое. pm2-конфиг каждой версии лежит внутри её папки — процесс при деплое пересоздаётся из новой папки. Для node/next симлинк переключается только после того, как новая версия ответила по HTTP.

Общее: HTTPS через certbot/Let's Encrypt при наличии `domain` (сертификат не перевыпускается зря), идемпотентность повторного деплоя, подробный лог каждого шага. Оркестрация в desktop: `runDeploy` в `apps/desktop/src/main/index.ts`, UI `deploy-tab.tsx` (живой лог + системное уведомление о результате).

## Возврат предыдущей версии (откат)

`rollbackProject` + `listReleases` в `packages/core/src/index.ts`: у сайтов переключается симлинк `current`, у приложений pm2 пересоздаётся из папки предыдущей версии (с проверкой ответа по HTTP; если у версии был другой порт, nginx перенастраивается на него). Кнопка «Вернуть предыдущую версию» — на вкладке «Деплой» (IPC `deploy:rollback`, оркестрация `runRollback` в `apps/desktop/src/main/index.ts`); записи отката попадают в историю с пометкой (`kind: "rollback"`). Для проектов, задеплоенных до появления структуры версий, и для импортированных проектов до первого деплоя откат недоступен — приложение объясняет почему.

## Импорт существующего приложения

Сценарий для серверов, где приложения крутились до подключения Plantar. Ничего не устанавливает на сервер:

- **Обнаружение** — `discoverApps` в `packages/core/src/discover.ts`: `pm2 jlist` (имя, папка, entrypoint, статус, пути логов, PORT из env), `ss -tlnp` + `ps -eo pid,ppid` (слушающие порты, в том числе у дочерних процессов `npm start`), `nginx -T` (домен → upstream-порт, файл конфига, пути логов; поддерживаются upstream-блоки), git-remote папки приложения (`origin`, ветка, подпапка в монорепозитории; ssh-адреса приводятся к https — `normalizeGitUrl`). Тип предлагается автоматически: python-скрипт → бот, папка `.next` → Next.js, есть порт → node, иначе бот.
- **UI** — кнопка «Найти приложения» на экране сервера открывает диалог «Найдено на сервере» (`discover-apps-dialog.tsx`, IPC `server:discover`): список приложений с предзаполненными полями (название, тип, домен, порт) и фактами с сервера (папка, pm2-процесс, статус); уже добавленные проекты не показываются. «Добавить» создаёт внешний проект (IPC `projects:import`).
- **Внешний проект** (`external` в `ProjectRecord`, `packages/storage`) — Plantar управляет им сразу: живые логи идут по фактическим путям pm2/nginx процесса, переменные и статус работают. Пока источник кода не привязан, настройки живут в записи проекта (plantar.json нет). Если у приложения на сервере нашёлся git-remote, вкладка «Деплой» предлагает «Подключить репозиторий» (IPC `projects:linkRepo`): репозиторий клонируется как обычный git-проект (с веткой и подпапкой монорепозитория), иначе — «Указать папку с кодом» (IPC `projects:linkFolder`). В обоих случаях plantar.json создаётся из подтверждённых при импорте настроек поверх автоопределённых. Проект помечен бейджем «Внешний», возврат версии недоступен и это объяснено в UI.
- **Первый деплой** переводит приложение под управление Plantar (`takeover` в `DeployOptions`): прежний pm2-процесс снимается (порт освобождается), прежний конфиг nginx отключается (симлинк в sites-enabled удаляется, обычный файл переносится в sites-available; конфиг вне sites-enabled не трогается — об этом пишется в лог), приложение переходит на структуру `releases/current`, пометка «внешний» снимается — становится доступен возврат версии. Файлы старого приложения на сервере не удаляются.

## Деплой из GitHub-репозитория

Второй источник проекта наряду с локальной папкой (`add-project-dialog.tsx` — выбор источника):

- **Публичные и приватные репозитории.** По вставленной ссылке приложение делает `git clone` в локальную папку `reposDir()` (`~/Library/Application Support/plantar/repos/<id>`) и дальше запускает обычный пайплайн деплоя из папки — серверу доступ к GitHub не нужен. Клонирование, обновление, список веток и чтение коммита — `apps/desktop/src/main/git.ts` (через `execFile("git", …)`, токен передаётся заголовком `http.extraHeader`, а не в URL). `plantar.json` хранится как untracked-файл в клоне и переживает обновление.
- **Выбор ветки.** В форме — выпадающий список веток (`git ls-remote --symref`), по умолчанию выбрана дефолтная ветка репозитория.
- **Папка проекта в репозитории (монорепозитории).** Опционально можно указать подпапку внутри репозитория, если проект лежит не в корне (`subdir` в `ProjectRecord`; по умолчанию — корень). Выбор через нативный диалог в корне клона (`projects:pickSubdir`), настройки переопределяются автоопределением по выбранной папке. Эффективная папка проекта = `path` + `subdir`; git-операции идут по корню клона.
- **Redeploy.** Для git-проектов кнопка деплоя всегда сначала обновляет клон (`git fetch` + checkout + `reset --hard origin/<branch>`), затем деплоит. В карточке проекта (вкладка «Деплой») виден хеш и сообщение задеплоенного коммита (`deployedCommit` в `ProjectRecord`).
- **Авторизация GitHub (Device Flow).** Вход без собственного backend, только по `client_id` (`apps/desktop/src/main/github.ts`). Токен шифруется системным keychain (`safeStorage`, файл `github-token.enc`), приватные репозитории клонируются с ним. В настройках — подключённый аккаунт и кнопка выхода (`settings-dialog.tsx`, `github-login-dialog.tsx`).

## Деплой при коммите (GitHub Actions)

Кнопка «Настроить деплой при коммите» на вкладке «Коммиты» (git-проекты): после одного клика каждый push в ветку проекта деплоит его на сервер без участия приложения. UI — `setup-ci-dialog.tsx`, IPC `github:setupActions`, оркестрация — `setupGithubActions` в `apps/desktop/src/main/index.ts`, работа с GitHub API — `apps/desktop/src/main/github-actions.ts`:

- Генерируется **отдельный deploy-ключ** ed25519 (личный ключ пользователя не используется), публичная часть добавляется в `authorized_keys` сервера (`installPublicKey`).
- Приватный ключ и адрес сервера записываются в Secrets репозитория (`PLANTAR_SSH_KEY`, `PLANTAR_HOST`, `PLANTAR_PORT`, `PLANTAR_USER`) через GitHub API; значения шифруются публичным ключом репозитория (sealed box, `libsodium-wrappers`). Хранение ключа в GitHub Secrets — осознанное исключение из local-first, см. README («Принципы»).
- В ветку проекта одним коммитом (Git Data API) добавляются `.github/workflows/plantar-deploy.yml` и `plantar.json` (в клоне он untracked, поэтому в репозитории его обычно нет). Workflow на push ставит `@plantar/cli` из npm и запускает `plantar deploy` с ключом из Secrets; для static-проектов с pnpm/yarn/bun ставится нужный пакетный менеджер.
- Требуются вход в GitHub (Device Flow, scope `repo`) и право пуша в репозиторий. Повторный запуск идемпотентен по файлам (без изменений — без коммита), но создаёт новый deploy-ключ и перезаписывает Secrets.
- Ограничение: деплой из GitHub Actions пишет историю на CI-машине, поэтому в истории и бейджах коммитов приложения такие деплои пока не видны; отображение планируется (например, чтение статусов запусков workflow через API).

## Переменные окружения

Хранятся на сервере в `/var/www/.plantar/env/<name>.env` (не в папке релиза — деплой их не затирает; права 600). Функции `readProjectEnv` / `writeProjectEnv` в `packages/core/src/index.ts`. При деплое: для static подставляются в локальную сборку, для Next.js копируются в `.env` перед серверной сборкой, для node/bot — рядом с кодом перед запуском; локальные `.env`-файлы из проекта на сервер не загружаются. UI: `env-tab.tsx` — редактор с импортом из локальных `.env`-файлов проекта (IPC `env:*` в `apps/desktop/src/main/index.ts`).

## Логи

- Живой стрим (desktop): `logStreamCommand` в `packages/core/src/index.ts` (tail -F, переживает ротацию) + `execStream`; два источника — приложение (pm2 out/error) и nginx (access/error). IPC `logs:streamStart/Stop` в `apps/desktop/src/main/index.ts`, UI `logs-tab.tsx` (пауза, раздельные каналы «Вывод/Ошибки»). Просмотренные nginx-логи по настройке сохраняются локально.
- Снапшот nginx-логов (CLI): `getSiteLogs` в core + `saveServerLogSnapshot` в storage.

## Статус приложения и мониторинг

Вкладка «Статус» проекта показывает данные самого приложения (`app-status-tab.tsx`, IPC `metrics:*`), а не сервера:

- **Здоровье процесса** — `pm2ProcessHealth` в `packages/core/src/status.ts`: статус, время запуска, число перезапусков, текущие CPU/память процесса из `pm2 jlist`. Для static-сайтов вместо карточки процесса — пояснение, что отдельного процесса нет.
- **Посещаемость** (node/next/static) — `getTrafficStats` в `packages/core/src/monitoring.ts`: GoAccess на сервере разбирает access-лог nginx вместе с ротированными копиями (~2 недели), графики (shadcn chart + recharts, `components/ui/chart.tsx`): запросы/посетители по дням, распределение по часам, счётчики ошибок, популярные страницы. Без GoAccess вкладка предлагает установить его на экране сервера. Если у приложения нет собственного access-лога (внешний конфиг без `access_log` или ещё не было деплоя), вкладка объясняет, что посещения не записываются и журнал появится после первого деплоя (`logMissing` в `TrafficStats`).

Экран сервера (`server-monitoring.tsx`) — опциональные инструменты мониторинга, устанавливаются по явному выбору пользователя (`installMonitoringTool`, IPC `monitoring:*`; идемпотентно, из репозитория Ubuntu):

- **GoAccess** — статистика посещений, работает только в момент проверки.
- **Netdata** — история нагрузки сервера (CPU/память за час или сутки, `getServerMetrics`, IPC `metrics:server`). При установке привязывается к 127.0.0.1 (запросы идут по SSH, наружу порт не открыт), ML-анализ отключён; конфиг перезаписывается только при свежей установке.

## История деплоев

`packages/storage/src/index.ts` — `history.json` (когда, проект, сервер, успех/ошибка, url, путь к полному логу) + файлы логов `logs/<name>/deploy-<время>.log`. UI: `history-tab.tsx` с просмотром лога любого деплоя (IPC `history:*`).

## Удаление проекта

- Из списка приложения — просто запись из `projects.json`.
- С сервера — `removeDeployedProject` в `packages/core/src/index.ts`: pm2-процесс, файлы, env-файл, конфиг nginx. UI: `remove-project-dialog.tsx`.

## Локальное хранилище и настройки

`packages/storage/src/index.ts` — всё в директории данных ОС (macOS: `~/Library/Application Support/plantar`): `servers.json`, `projects.json`, `history.json`, `settings.json`, `logs/`, `keys/`. Настройки приложения (`settings-dialog.tsx`): email для Let's Encrypt, сохранение копий серверных логов, уведомление об успешном деплое.

## Локализация (i18n)

Весь пользовательский текст (GUI, CLI, деплой-лог, ошибки) переведён на русский и английский:

- `packages/i18n` — общий механизм для Node-кода: текущий язык процесса (`setLanguage`/`getLanguage`, по умолчанию из локали системы: русская → ru, иначе en) и фабрика `createT(messages)`. Словари живут рядом с кодом: `packages/{core,config,ssh}/src/messages.ts`, `apps/cli/src/messages.ts`, `apps/desktop/src/main/i18n.ts`.
- Renderer (React): `apps/desktop/src/renderer/src/i18n/` — `ru.ts` (эталон ключей), `en.ts`, `index.tsx` (`I18nProvider`, хук `useI18n` → `t(key, params)`). Компоненты не содержат захардкоженных пользовательских строк.
- Язык хранится в настройках (`language` в `AppSettings`, `packages/storage`). Desktop: переключатель в диалоге настроек, применяется сразу, без перезапуска; main-процесс узнаёт о смене через `settings:set`. CLI читает язык из тех же настроек при старте.

## Desktop GUI

`apps/desktop` (Electron, electron-vite):

- `src/main/index.ts` — все IPC-обработчики (формат `{ok, data} | {ok, error}`), системные уведомления о деплое (клик открывает проект).
- `src/preload/index.ts` — мост `window.plantar` (типы в `index.d.ts`).
- `src/renderer/src/app.tsx` — корень: сайдбар «серверы → проекты» (`sidebar.tsx`), у проекта вкладки Деплой / Переменные / Статус / Логи / История, диалоги, глобальный показ ошибок.
- `src/renderer/src/components/ui/` — базовые UI-компоненты (button, dialog, input, tabs, …).

## CLI

`apps/cli/src/index.ts` (commander) — команды `info`, `setup`, `deploy`, `logs`, `history`, `ls` с опциями подключения. Подробно: [docs/cli.md](cli.md).

## Примеры

`examples/` — демо-проекты для проверки деплоя: `react-demo-app` (static), `node-demo-app` (node), `bot-demo-app` (Telegram-бот на node), `aiogram-demo-app` (Telegram-бот на python).
