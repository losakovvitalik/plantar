# Функции проекта

Краткое описание основных функций проекта и какие файлы за них отвечают.

Plantar — local-first инструмент деплоя приложений на Ubuntu-серверы (22.04/24.04) для не-программистов. Две оболочки — desktop GUI (`apps/desktop`, Electron + React) и CLI (`apps/cli`) — используют общую логику из пакетов:

| Пакет | Назначение |
| --- | --- |
| `packages/ssh` | SSH-соединение (ssh2): exec, стриминг вывода, SFTP-загрузка директорий, `shellQuote` |
| `packages/core` | Вся deploy-логика: проверка и подготовка сервера, деплой, env, логи, удаление |
| `packages/config` | Схема `plantar.json` (zod), чтение/запись, автоопределение типа проекта |
| `packages/storage` | Локальные данные: серверы, проекты, история, настройки, логи, ключи |

## SSH-подключение

`packages/ssh/src/index.ts` — класс `SshConnection`: `exec` (команда → stdout/stderr/код), `execStream` (живой вывод с остановкой), `uploadDirectory` (рекурсивная SFTP-загрузка с исключениями), `listDirectories`. Keepalive раз в 15 секунд.

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

- Схема конфига: `name`, `type` (static | node | bot), `runtime` (node | python), `packageManager`, `buildCommand`, `buildDir`, `startCommand`, `port`, `domain`. Regex на `name` и `domain` заодно защищают от shell-инъекций.
- `detectProjectConfig` — автоопределение по файлам проекта: пакетный менеджер по lockfile, фреймворк (Vite, CRA, Express/Fastify/NestJS/…, grammY/Telegraf, aiogram/python-telegram-bot), тип проекта и команда запуска.
- Добавление проекта в GUI: выбор папки → предзаполненная форма настроек → создание `plantar.json` (`apps/desktop/src/main/index.ts`: `pickProjectFolder`, `addProject`; UI `project-settings-dialog.tsx`). Имя проекта проверяется на уникальность в пределах сервера.
- Настройки проекта редактируются в том же диалоге; после сохранения предлагается деплой в один клик (`app.tsx`).

## Деплой

`deployProject` в `packages/core/src/index.ts`, три сценария по `type`:

- **static** — локальная сборка (`buildCommand`, env-переменные с сервера подставляются в окружение сборки), загрузка в staging-папку с атомарной подменой `/var/www/<name>`, конфиг nginx (раздача статики; без домена — default_server по IP).
- **node** — загрузка кода (без node_modules, .git, .env), установка зависимостей на сервере, запуск через pm2 (ecosystem-конфиг, автозапуск после перезагрузки), автоподбор свободного порта 3001–3999 с закреплением в `plantar.json`, проверка что приложение отвечает по HTTP, nginx как reverse proxy.
- **bot** (Telegram-бот, runtime node или python) — то же без nginx и порта; для python — venv + `pip install -r requirements.txt`; проверка что pm2-процесс стабильно живёт.

Общее: HTTPS через certbot/Let's Encrypt при наличии `domain` (сертификат не перевыпускается зря), идемпотентность повторного деплоя, подробный лог каждого шага. Оркестрация в desktop: `runDeploy` в `apps/desktop/src/main/index.ts`, UI `deploy-tab.tsx` (живой лог + системное уведомление о результате).

## Деплой из GitHub-репозитория

Второй источник проекта наряду с локальной папкой (`add-project-dialog.tsx` — выбор источника):

- **Публичные и приватные репозитории.** По вставленной ссылке приложение делает `git clone` в локальную папку `reposDir()` (`~/Library/Application Support/plantar/repos/<id>`) и дальше запускает обычный пайплайн деплоя из папки — серверу доступ к GitHub не нужен. Клонирование, обновление, список веток и чтение коммита — `apps/desktop/src/main/git.ts` (через `execFile("git", …)`, токен передаётся заголовком `http.extraHeader`, а не в URL). `plantar.json` хранится как untracked-файл в клоне и переживает обновление.
- **Выбор ветки.** В форме — выпадающий список веток (`git ls-remote --symref`), по умолчанию выбрана дефолтная ветка репозитория.
- **Папка проекта в репозитории (монорепозитории).** Опционально можно указать подпапку внутри репозитория, если проект лежит не в корне (`subdir` в `ProjectRecord`; по умолчанию — корень). Выбор через нативный диалог в корне клона (`projects:pickSubdir`), настройки переопределяются автоопределением по выбранной папке. Эффективная папка проекта = `path` + `subdir`; git-операции идут по корню клона.
- **Redeploy.** Для git-проектов кнопка деплоя всегда сначала обновляет клон (`git fetch` + checkout + `reset --hard origin/<branch>`), затем деплоит. В карточке проекта (вкладка «Деплой») виден хеш и сообщение задеплоенного коммита (`deployedCommit` в `ProjectRecord`).
- **Авторизация GitHub (Device Flow).** Вход без собственного backend, только по `client_id` (`apps/desktop/src/main/github.ts`). Токен шифруется системным keychain (`safeStorage`, файл `github-token.enc`), приватные репозитории клонируются с ним. В настройках — подключённый аккаунт и кнопка выхода (`settings-dialog.tsx`, `github-login-dialog.tsx`).

## Переменные окружения

Хранятся на сервере в `/var/www/.plantar/env/<name>.env` (не в папке релиза — деплой их не затирает; права 600). Функции `readProjectEnv` / `writeProjectEnv` в `packages/core/src/index.ts`. При деплое: для static подставляются в сборку, для node/bot копируются как `.env` рядом с кодом; локальные `.env`-файлы на сервер не загружаются. UI: `env-tab.tsx` — редактор с импортом из локальных `.env`-файлов проекта (IPC `env:*` в `apps/desktop/src/main/index.ts`).

## Логи

- Живой стрим (desktop): `logStreamCommand` в `packages/core/src/index.ts` (tail -F, переживает ротацию) + `execStream`; два источника — приложение (pm2 out/error) и nginx (access/error). IPC `logs:streamStart/Stop` в `apps/desktop/src/main/index.ts`, UI `logs-tab.tsx` (пауза, раздельные каналы «Вывод/Ошибки»). Просмотренные nginx-логи по настройке сохраняются локально.
- Снапшот nginx-логов (CLI): `getSiteLogs` в core + `saveServerLogSnapshot` в storage.

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
