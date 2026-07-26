---
name: resolve-issue
description: Resolve a GitHub issue end-to-end in an isolated git worktree — read the issue, implement the fix on a fresh branch from origin/main, run typecheck/tests, push and open a PR that closes the issue. The current checkout, its branch, and uncommitted changes are never touched, so another agent can keep working here. Use when the user asks to fix/close an issue or create a PR for an issue (закрыть issue, сделать PR для issue, реши issue N), or invokes /resolve-issue <number|url>.
---

# Resolve a GitHub issue via worktree + PR

Argument: an issue number or URL (e.g. `12` or `https://github.com/losakovvitalik/plantar/issues/12`).

Hard rule: **do not switch branches, edit files, or run installs in the main checkout.** All work happens in a dedicated worktree at `../plantar-worktrees/issue-<N>`. The only commands run from the main checkout are `git fetch`, `git worktree add`, and reading files for context.

## 1. Read the issue

```bash
gh issue view <N> --json number,title,body,labels,comments \
  -q '{number: .number, title: .title, body: .body, labels: [.labels[].name], comments: [.comments[].body]}'
```

Read every file the issue references (in the main checkout, read-only) before planning. If the issue has a Definition of Done checklist, treat each checkbox as an acceptance criterion — the PR must satisfy all of them.

## 2. Create the worktree

Branch from `origin/main`, never from the current HEAD (it may be an unrelated feature branch):

```bash
git fetch origin main
git worktree add ../plantar-worktrees/issue-<N> -b <type>/issue-<N>-<slug> origin/main
```

`<type>` is `fix` for bugs, `feat` for features (match the issue label). `<slug>` is a short English kebab-case summary, e.g. `fix/issue-12-silent-renderer-errors`.

If the branch or worktree already exists from a previous attempt: `git worktree list`, then `git worktree remove <path>` and `git branch -D <branch>` before retrying.

## 3. Install dependencies in the worktree

```bash
cd ../plantar-worktrees/issue-<N> && pnpm install --prefer-offline
```

Fast (~2 s) — everything is reused from the pnpm store, no downloads.

## 4. Implement

Work only inside the worktree, using absolute paths for all edits. Follow CLAUDE.md and project conventions:

- All user-facing strings go through i18n dictionaries in **both** `ru` and `en` (renderer: `apps/desktop/src/renderer/src/i18n/`; Node code: `messages.ts` + `createT` from `@plantar/i18n`). No hardcoded UI text.
- UI texts: formal («вы»), impersonal, no tech jargon (аудитория — не-программисты).
- File names kebab-case; code comments in English.
- Minimal diff — touch only what the issue requires.

## 5. Verify

There are no aggregate scripts at the repo root — run checks per touched package, from inside that package's directory:

```bash
# apps/desktop has a typecheck script:
cd ../plantar-worktrees/issue-<N>/apps/desktop && pnpm run typecheck && pnpm test

# other packages (packages/core, packages/storage, ...):
cd ../plantar-worktrees/issue-<N>/packages/<pkg> && pnpm exec tsc --noEmit && pnpm test
```

If `eslint.config.js` exists at the worktree root, also lint **only the changed files** (`pnpm exec eslint <files>`); old code carries a known baseline of ~72 errors, never lint the whole repo. As of 2026-07-24 there is no ESLint tooling in the repo — skip linting then.

## 6. Commit, push, PR

Everything on GitHub is in English (commit, branch, PR title/body).

```bash
cd ../plantar-worktrees/issue-<N>
git add <files> && git commit -m "$(cat <<'EOF'
fix(desktop): <summary in English>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git push -u origin <branch>
gh pr create --base main --title "<conventional title>" --body "$(cat <<'EOF'
## Summary
<what changed and why, per issue requirement>

Closes #<N>

## Testing
<exact commands run and their results>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL to the user. **Leave the worktree in place** — review follow-ups reuse it. After the PR is merged: `git worktree remove ../plantar-worktrees/issue-<N>` and `git branch -D <branch>`.

## Gotchas (all hit for real)

- `npx tsc` anywhere under the repo root fails with `EBADDEVENGINES` — the root `package.json` declares pnpm in `devEngines`. Always use `pnpm exec tsc` from inside a package directory.
- `pnpm exec eslint` fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "eslint" not found` — ESLint is not installed in the repo. Check for `eslint.config.js` before linting.
- `git worktree remove` on your own shell cwd leaves the shell in a deleted directory and the next git command dies with `Unable to read current working directory`. Leave the worktree dir (or `cd` out) before removing it.
- The shell cwd does not persist between Bash calls — prefix worktree commands with an explicit `cd <worktree-path> &&` every time, or use absolute paths.
