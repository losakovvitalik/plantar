---
name: ship-issue
description: Доводит issue до готового к мержу PR без переключения сессий — сам вызывает resolve-issue, затем гоняет цикл ревью/исправлений через свежих сабагентов, пока не останется 🔴-блокеров, и останавливается перед мержем. Принимает один или несколько номеров issue. Используй когда пользователь просит закрыть issue целиком, довести issue до мержа, или вызывает /ship-issue <N> [<N>...].
user-invocable: true
---

# /ship-issue — issue → PR → ревью-цикл → готов к мержу

Аргументы: один или несколько номеров issue (`21`, `21 22 23`).

Заменяет ручной цикл «сессия A формулирует → сессия B решает → сессия A ревьюит → сессия B чинит → …».
Роли разносятся не по сессиям, а по сабагентам: каждый вызов `Agent` стартует с чистым контекстом,
поэтому ревьюер не видит рассуждений автора и не защищает его код.

**Ты — только оркестратор.** Сам не читаешь diff, не правишь код, не ревьюишь.
Твоя работа: запускать сабагентов, парсить их вердикты, считать раунды, свести итог.

## Инварианты

- Главный чекаут `/Users/vitaliy/Projects/plantar` не трогается: ни `git checkout`, ни правок, ни `pnpm install`.
  Вся работа по issue N живёт в `../plantar-worktrees/issue-<N>` (его создаёт `resolve-issue`).
- Мерж **не делается никогда**. Финал — сводка пользователю и команда для мержа.
- Всё, что уходит на GitHub (коммиты, PR, комментарии ревью), — по-английски.
- Максимум 3 раунда ревью на issue. Не сошлось — стоп и честный отчёт.
- Ответ сабагента обязан кончаться обещанным fenced-JSON. Нет блока или не парсится → один
  переспрос через `SendMessage` («reply with only the json block, nothing else»); снова нет —
  стоп по этой issue, отчёт пользователю.

## Ход работы

Несколько issue обрабатываются **параллельно** — worktree у каждой свой, они не конфликтуют.
Запускай их сабагентов одним сообщением с несколькими вызовами `Agent`.

### 0. Проверка входа

Для каждого номера: `gh issue view <N> --json number,state,title`.
Закрытая или несуществующая issue — пропусти её и скажи об этом; остальные обрабатывай.

Затем — нет ли уже открытого PR по этой issue: `gh pr list --state open --json number,headRefName,body`,
ищи `Closes #<N>` в body или ветку `…/issue-<N>-…`. Есть → раунд 0 пропусти и заходи сразу в
ревью-цикл (шаг 2) с этим PR: так повторный запуск продолжает работу, а не пересоздаёт ветку
(push от resolve-issue отвергся бы non-fast-forward). Если worktree этой issue уже удалён —
восстанови его до цикла: `git fetch origin && git worktree add ../plantar-worktrees/issue-<N> <headRefName>`,
затем `pnpm install --prefer-offline` внутри.

### 1. Раунд 0 — реализация

Сабагент (`general-purpose`), для каждой issue:

> Invoke the `resolve-issue` skill with argument `<N>`. Follow it exactly.
> Your final message must be only the PR URL, nothing else. If you could not open a PR, reply
> `FAILED: <one-line reason>`.

Из ответа достань номер PR. `FAILED` — эта issue выбывает, идём дальше по остальным.

### 2. Раунд K (1..3) — ревью

Свежий сабагент (`general-purpose`) на каждый раунд — **никогда не переиспользуй ревьюера
через `SendMessage`** (кроме единственного переспроса за JSON), иначе он якорится на прошлом
ревью и на своих же выводах:

> Invoke the `ship-review` skill with argument `<PR>`. Follow it exactly.

Скилл сам публикует английское GitHub-ревью с inline-замечаниями, разбирает нерезолвленные треды
прошлых раундов и заканчивает ответ fenced-JSON (`blockers` / `suggestions` / `resolved` / `verdict`).
У находок есть `threadId` — `null` означает, что заанкорить строку было некуда.

Парсишь JSON. Пусто в `blockers` → issue готова, переходи к шагу 4. `suggestions` этого раунда чинить
уже некому — шаг 3 не запускается, — поэтому сохрани их: они идут в итоговый отчёт, иначе исчезнут.
Это осознанный перекос: чистый раунд значит «отгружаем», а не «полируем», и судьбу 🟡 решает
пользователь по отчёту, а не ещё один круг правок.

Реестр открытых находок не держи в голове — он живёт нерезолвленными тредами на GitHub, и ревьюер
следующего раунда обязан по каждому вынести вердикт. Именно это не даёт находке потеряться между
раундами или тихо понизиться в серьёзности.

### 3. Раунд K — исправления

Свежий сабагент (`general-purpose`), контекст — worktree, уже созданный на шаге 1:

> Work only in `/Users/vitaliy/Projects/plantar-worktrees/issue-<N>` — absolute paths for every edit,
> and prefix every shell command with `cd` into it (cwd does not persist between calls).
> First read the task context — `gh issue view <N> --json title,body` and
> `gh pr view <PR> --json title,body` — you need the issue's goal to judge the findings.
> A reviewer raised these findings on PR #<PR>: <вставь blockers и suggestions как JSON>.
>
> For each finding, first decide whether it is actually correct — reviewers do get things wrong.
> Fix the ones that are real, with the minimal diff. For any finding you reject, do not touch the
> code; instead state the reason. Apply 🟡 suggestions only when the fix is small and clearly right.
>
> Follow the project conventions in `CLAUDE.md`: file names kebab-case, code comments in English
> (in new files and in new lines of existing ones alike), user-facing strings only through the i18n
> dictionaries and added to both languages at once. Do not rewrite pre-existing comments.
>
> Then verify per touched package (`pnpm run typecheck && pnpm test` in `apps/desktop`,
> `pnpm exec tsc --noEmit && pnpm test` in `packages/*` — never `npx tsc`), commit, and push to the
> existing branch.
>
> Answer the reviewer in English, in place. A finding that has a `threadId` gets a reply in its own
> thread (`gh api repos/<owner>/<repo>/pulls/<PR>/comments/<databaseId>/replies -f body='...'`, where
> `databaseId` is the first comment of that thread); findings with `threadId: null` get one ordinary
> PR comment covering all of them. Say what you fixed and, for anything you rejected, why.
>
> **Never resolve a thread yourself** — only the next reviewer closes them, after checking the code.
> Marking your own fix as done is exactly the self-certification the loop exists to avoid.
>
> Your final message must end with a fenced `json` block and nothing after it:
> ```json
> {"fixed": [{"finding": "...", "threadId": "<id|null>"}],
>  "rejected": [{"finding": "...", "threadId": "<id|null>", "reason": "..."}],
>  "checks": "pass" | "fail", "note": "<one line, or empty>"}
> ```

`checks: "fail"` → сабагент обязан был починить до зелёного; если не смог — стоп по этой issue,
отчёт пользователю. Иначе K += 1 и назад на шаг 2.

Разногласие видно по тредам: фиксер отклонил находку с обоснованием, ревьюер следующего раунда
оставил её тред открытым. Один такой круг допустим — ревьюер мог привести новый аргумент. Тот же
тред открыт после **двух** кругов — стоп по этой issue: выноси пользователю сам тред, позицию
фиксера и позицию ревьюера. Это спор о продукте, а не баг, и цикл его не решит.

### 4. Готовность

Дождись CI: `gh pr checks <PR> --watch --fail-fast` (если чеки настроены; их отсутствие — не ошибка).
Красный CI → раунд исправлений (шаг 3) с текстом падения вместо находок ревью. CI-фикс — не
ревью-раунд: K не растёт, и после него возвращайся сюда к `gh pr checks`, а не на шаг 2 —
ревью уже пройдено. Не больше 2 CI-фиксов подряд; не позеленело — стоп и отчёт.

Worktree **не удаляй** — он нужен, если пользователь после просмотра diff попросит что-то доправить.

## Итоговый отчёт

Одна таблица на все issue, без простыней:

```
| Issue | PR | Раундов | Итог |
|-------|-----|---------|------|
| #21   | #34 | 2       | ✅ готов к мержу |
| #22   | #35 | 3       | ⚠️ остались блокеры: <кратко> |
| #23   | —   | —       | ❌ resolve-issue упал: <причина> |
```

Под таблицей, для каждой готовой issue:
- 1–2 строки, что реально поменялось в коде;
- что ревьюер находил и что фиксер отклонил (это пользователю важнее всего — там прячутся спорные места);
- оставшиеся 🟡 последнего раунда, если были: по строке на каждую, с `path:line`, и к каждой —
  рекомендация: **чинить сейчас** (правка минимальна и однозначна — текст, перевод, удаление мусора
  из ветки: докинуть коммитом дешевле, чем оформлять issue) или **follow-up issue** (нужно выбирать
  решение или трогать архитектуру — такое не раздувает PR после approve). Мерж они не держат, решение
  за пользователем — сам ничего не чини и issue не заводи. Их треды (и 🟢) остаются на GitHub
  нерезолвленными — следующего ревьюера не будет, закрыть их после решения может только пользователь;
- команда мержа, одной строкой (worktree удаляется первым: пока ветка checked out в worktree,
  `--delete-branch` не сможет удалить локальную ветку, gh вернёт ошибку, и до `git worktree remove`
  дело уже не дойдёт; бонус — remove откажет при ручных правках в worktree ещё до мержа):
  `git worktree remove ../plantar-worktrees/issue-<N> && gh pr merge <PR> --squash --delete-branch`

Если пользователь согласился на триаж: follow-up issue заводи по-английски **до** запуска фиксера,
чтобы у того была ссылка; затем один сабагент-фиксер на все «чинить сейчас» — он же отвечает в тредах
(отложенным — ответ со ссылкой на созданную issue) и, как обычно, ничего не резолвит сам. Полировка —
не ревью-раунд: K не растёт, после неё только повторный `gh pr checks`, а не шаг 2.

Не мержи сам, даже если всё зелёное и пользователь раньше в этой сессии мержил такие же PR.

## Грабли

- `allowed-tools` у скилла — это пре-одобрение на ход, вызвавший скилл, а не ограничение: остальные
  инструменты доступны, но идут через обычные permissions. У `ship-review` в списке есть
  `gh api` и `Write`, поэтому ревьюер публикует ревью без промпта.
- CI (`ci.yml`) гоняет tsc и vitest по всем пакетам на каждый PR, так что `gh pr checks` на шаге 4 —
  настоящие ворота. Самоотчёт фиксера остаётся ранним сигналом, но итоговое слово за чеками.
- Параллельные issue ветвятся от одного `origin/main`. Пересекающиеся правки дадут конфликт при мерже
  второго PR — это ожидаемо и решается пользователем, не циклом. Если issue заведомо трогают одни файлы,
  скажи об этом до старта и предложи гнать их последовательно.
- Их же сабагенты крутят `git fetch` и `git worktree add` в одном main-чекауте — возможен транзиентный
  `cannot lock ref` / `index.lock`. `FAILED` с такой ошибкой — не приговор issue: перезапусти её
  сабагента один раз, прежде чем списывать.
- Сабагенты по умолчанию фоновые: запустил — жди уведомления, не опрашивай их и не выдумывай результат.
