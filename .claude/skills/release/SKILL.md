---
name: release
description: Выпускает новую версию Plantar — считает следующий номер по коммитам с прошлого тега, бампит версию в apps/desktop и apps/cli, пушит тег, ведёт релизный workflow, пишет заметки по-английски и после подтверждения снимает с релиза черновик; отдельным шагом публикует @plantar/cli в npm. Используй когда пользователь просит выпустить новую версию, сделать релиз, выложить сборки для пользователей, или вызывает /release [версия|patch|minor|major].
user-invocable: true
---

# /release — версия → тег → сборки → опубликованный релиз

Аргумент (необязательный): точный номер (`0.2.0`) или ступень (`patch` | `minor` | `major`).
Без аргумента номер предлагаешь сам, но утверждает его пользователь.

## Что делает CI, а что — ты

Пуш тега `v*` запускает `.github/workflows/release.yml`: e2e-смоук как ворота → сборка
mac/win/linux → `electron-builder --publish always` заливает ассеты. Дальше — ручная часть,
ради которой и нужен скилл:

- electron-builder создаёт **черновик** релиза (`releaseType` по умолчанию `draft`) — пользователи его не видят;
- заметок он не пишет (у 0.1.0 тело релиза пустое);
- tsc и юнит-тесты релизный workflow не гоняет, их гоняет `ci.yml` на пуш в main — зелёный main проверяешь до тега;
- `@plantar/cli` на npm лежит, но CI его не публикует.

## Инварианты

- Версия одна на оба приложения: `apps/desktop/package.json` и `apps/cli/package.json` бампятся вместе.
  `packages/*` приватные, у них `0.0.0` — не трогаешь.
- Всё, что уходит на GitHub (коммит, тег, заметки), — по-английски. Заметки пишутся для непрограммистов:
  что изменилось для человека, без жаргона.
- Необратимых шага три: пуш тега, снятие черновика, `npm publish`. Перед каждым спрашиваешь отдельно,
  ровно перед ним. Одно «да» не переносится на следующий шаг.
- Схема 0.x: breaking → minor, feat → minor, только fix/perf/chore → patch.
- Опубликованный релиз не переписывается, тег не двигается. Беда нашлась после публикации — новая патч-версия.
- `npm login` и OTP не вводишь никогда, это пароль: не залогинен — отдаёшь пользователю команду и ждёшь.

## Ход работы

### 1. Преflight

```bash
git fetch origin --tags
git rev-parse --abbrev-ref HEAD
git status --porcelain -- apps packages
git rev-parse origin/main
```

Не на `main` или отстал — `git checkout main && git pull --ff-only`. Непустой вывод `git status` по
`apps`/`packages` — стоп: неясно, что попадёт в сборку. Изменения вне них (`.claude/`, `docs/`) релизу
не мешают, но скажи о них — в сборку они не войдут.

Затем CI на текущем main:

```bash
gh run list --workflow=ci.yml --branch main -L 1 --json headSha,status,conclusion,url
```

`headSha` обязан совпадать с `origin/main`, `conclusion` — `success`. Красный CI или прогон для
другого коммита → стоп: релиз с непроверенного main не режется.

### 2. Номер версии

```bash
node -p "require('./apps/desktop/package.json').version"
git describe --tags --abbrev=0 origin/main
git log --no-merges --pretty=format:'%s' <последний тег>..origin/main
```

Раздели заголовки по типам и примени схему 0.x из инвариантов. Предложи номер через `AskUserQuestion`:
предложенный / соседняя ступень / свой. Аргумент скилла вопрос заменяет — тогда проверь только, что это
валидный semver, что он больше текущего и что тега ещё нет (`git tag -l v<X.Y.Z>`).

### 3. Бамп версии

Строку `"version"` (третья в обоих манифестах, других вхождений нет) правь точечно — `Edit` с заменой
`"version": "<старая>"` на `"version": "<X.Y.Z>"` в `apps/desktop/package.json` и `apps/cli/package.json`.

```bash
git diff --stat                                        # ровно два файла, по строке в каждом
git diff                                               # в диффе только номер версии
grep -rn "<старая версия>" README.md docs apps/*/package.json
```

`grep` ищет хвосты старого номера: README ссылается на `/releases/latest` и правок не требует, но если
где-то версия зашита — правь тем же коммитом. Дальше — коммит строго указанными путями (`-a` подхватил бы
чужие правки в рабочем дереве):

```bash
git add apps/desktop/package.json apps/cli/package.json
git commit -m "$(cat <<'EOF'
chore(release): v<X.Y.Z>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 4. Тег и пуш

Спроси подтверждение: пуш тега запускает публичную сборку. После «да» — main первым, тег вторым:

```bash
git push origin main
git tag -a v<X.Y.Z> -m "v<X.Y.Z>"
git push origin v<X.Y.Z>
```

Пуш main отвергнут (кто-то успел запушить) — `git pull --rebase` и заново; тега ещё нет, ничего не сломано.

### 5. Ведёшь workflow — в фоне

Одной фоновой командой (`run_in_background: true`), она вернётся, когда прогон закончится, с ненулевым
кодом при падении:

```bash
for i in $(seq 1 30); do
  id=$(gh run list --workflow=release.yml --branch v<X.Y.Z> --json databaseId -q '.[0].databaseId')
  [ -n "$id" ] && break
  sleep 5
done
echo "run: $id"; gh run watch "$id" --exit-status
```

У прогона по тегу `headBranch` — имя тега, отсюда `--branch v<X.Y.Z>`. Пуш main поднимет ещё и `ci.yml`:
ждать его не нужно (менялись только строки версии), но покрасневший бамп — сигнал, что что-то не то.

Пока идёт сборка, пиши заметки — шаг 6. Не опрашивай прогон и не выдумывай его исход.

### 6. Заметки к релизу

Материал — тела squash-коммитов, там как раз описан эффект для пользователя:

```bash
git log --no-merges --pretty=format:'%h %s%n%b---' <последний тег>..v<X.Y.Z>
```

Пиши по-английски, в файл (скретчпад сессии), по шаблону:

```markdown
## What's new
- <что человек теперь может сделать> (#161)

## Fixes
- <что перестало ломаться> (#158, #157)

## Installing
The builds are not signed yet, so the system will be suspicious on first launch — see the
[installation notes](https://github.com/losakovvitalik/plantar/blob/main/README.md#installation).
```

Правила текста:

- строка описывает эффект для пользователя, а не изменение в коде: не «pin the host key per key type»,
  а «Plantar now recognises the server by its key and warns you if that key changes»;
- несколько PR одной темы — одна строка со всеми номерами; десятки коммитов должны сложиться в 10–15 строк;
- `refactor`, `test`, `chore`, `ci` без видимого эффекта в заметки не идут;
- жаргон разворачивай (аудитория — непрограммисты), но не выдумывай того, чего в коммитах нет.

Черновик покажи пользователю целиком в ответе — правки он вносит до публикации.

### 7. Проверка ассетов и публикация

```bash
gh release view v<X.Y.Z> --json isDraft,assets -q '{draft: .isDraft, assets: [.assets[].name]}'
```

Обязаны быть все четыре установщика — `Plantar-<v>-arm64.dmg`, `Plantar-<v>.dmg`, `Plantar-Setup-<v>.exe`,
`Plantar-<v>.AppImage` — плюс `latest.yml`, `latest-mac.yml`, `latest-linux.yml`. Чего-то нет — не публикуй,
разбирайся с упавшей матрицей: `gh run view <id> --log-failed | tail -50`, перезапуск только упавших —
`gh run rerun <id> --failed` (черновик и уже залитые ассеты остаются на месте).

Всё на месте — спроси подтверждение на публикацию, покажи заметки ещё раз, и:

```bash
gh release edit v<X.Y.Z> --draft=false --latest --title "<X.Y.Z>" --notes-file <файл>
gh release view v<X.Y.Z> --json isDraft,isLatest,url
```

Заголовок без `v` — так их называет electron-builder (`0.1.0`), не ломай ряд.

### 8. CLI в npm

Спроси, публиковать ли CLI (пользователь мог захотеть только десктоп). После «да»:

```bash
pnpm whoami
pnpm -C apps/cli publish --access public --publish-branch main
```

`pnpm whoami` с ошибкой 401 → **сам не логинься**: отдай пользователю `npm login` (из `apps/cli`, из корня npm
блокируется devEngines) и дождись ответа.
Спросили OTP — тоже стоп, отдай ему команду публикации целиком.
Публикация ругается на грязное рабочее дерево из-за файлов вне `apps/` и `packages/` (например `.claude/`) —
убедись по `git status --porcelain`, что релизные папки чистые, и добавь `--no-git-checks`.
`prepublishOnly` соберёт `dist` сам. Проверка:

```bash
pnpm view @plantar/cli version
```

### 9. Если сборка упала

Тег уже есть, публичного релиза ещё нет — значит можно пересобрать ту же версию. Почини main обычным
циклом (PR / `/ship-issue`), затем убери тег с черновиком и повтори шаги 4–7 (коммит бампа уже в main,
повторно бампить не надо):

```bash
gh release delete v<X.Y.Z> --yes --cleanup-tag   # снесёт и черновик, и тег
git tag -d v<X.Y.Z>
```

После шага 7 это уже запрещено: опубликованную версию чинят следующей патч-версией.

## Итоговый отчёт

Коротко, без простыней:

```
| Версия | Релиз | Ассеты | npm |
|--------|-------|--------|-----|
| 0.2.0  | <url> | 4 установщика + 3 yml | @plantar/cli@0.2.0 |
```

Ниже — заметки, как они опубликованы, и одна строка про то, что осталось человеку: скачать `.dmg`
и открыть. e2e гоняется только на Linux, mac- и win-установщики не проверяет никто, а они не подписаны —
первый запуск на чистой машине глазами не заменить.

## Грабли

- `npm` в этом репозитории не нужен: `devEngines` в корне намеренно его блокирует
  (`Invalid name "pnpm" does not match "npm"`). `pnpm view`, `pnpm whoami`, `pnpm publish` работают из корня;
  если npm всё же понадобился (`npm login`) — только из `apps/cli`.
- Версию не бампят через `npm pkg set` и `jq`: оба переписывают JSON заново и разворачивают компактный
  массив `"arch": ["arm64", "x64"]` в `apps/desktop/package.json` — в релизном коммите появляется мусор.
- Пока черновик не снят, `/releases/latest` в README ведёт на прошлую версию — снаружи релиза как бы нет.
- `gh run watch` в foreground упрётся в лимит времени на команду — только фоном.
- Сборки не подписаны: памятка про `xattr -cr` и SmartScreen в README, в заметках на неё ссылка,
  а не копия текста.
- `gh release view` показывает черновик по имени тега — отдельная команда для драфтов не нужна.
