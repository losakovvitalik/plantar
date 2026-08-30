import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit, RemoteBranches } from "../shared/ipc";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);

/** Строки git-вывода бывают большими (история, файлы) — поднимаем лимит буфера */
const GIT_OPTS = { maxBuffer: 32 * 1024 * 1024 } as const;

/**
 * The single notion of "this URL points at GitHub" in the app. The host is
 * parsed out of the URL instead of being matched as text, so lookalikes never
 * pass: `https://github.com.evil.example/a/b`, `https://notgithub.com/a/b`
 * and `https://github.com@evil.example/a/b` all name a different host.
 *
 * `new URL()` is not the parser git uses, and where the two can disagree about
 * the host the answer is simply "no". A backslash ends the authority for
 * `new URL()` but not for git's, so `https://github.com\@evil.example/a/b`
 * reads as github.com here while git connects to evil.example; credentials in
 * the URL are the other half of that authority, and nothing in the app needs
 * them.
 */
export function isGithubUrl(url: string): boolean {
  if (url.includes("\\")) return false;
  try {
    const { protocol, hostname, username, password } = new URL(url);
    if (username || password) return false;
    return protocol === "https:" && hostname === "github.com";
  } catch {
    return false; // not even a URL — certainly not GitHub
  }
}

/**
 * Auth for git: the token travels as an Authorization header via the
 * GIT_CONFIG_* environment variables, not in the URL (it must never end up
 * in .git/config) and not in argv (argv is visible in `ps` output and gets
 * quoted into execFile error messages). The header exists only in the
 * environment of the single git process for the duration of the call.
 *
 * The token is a GitHub credential for every private repository of the
 * account, so it is attached only when the call really goes to github.com:
 * repository URLs are pasted by the user or read off a server, and no other
 * host may receive it. Redirects are switched off on the same call so git
 * cannot carry the header to another host on its own either.
 */
function authEnv(url: string, token?: string): NodeJS.ProcessEnv | undefined {
  if (!token || !isGithubUrl(url)) return undefined;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_CONFIG_KEY_1: "http.followRedirects",
    GIT_CONFIG_VALUE_1: "false",
  };
}

/**
 * Auth for a call that runs inside an existing clone: the destination host is
 * not among the arguments, so it is read from the clone's own origin remote.
 * A remote that cannot be read is treated as non-GitHub and gets no token.
 */
async function cloneAuthEnv(
  dir: string,
  token?: string,
): Promise<NodeJS.ProcessEnv | undefined> {
  if (!token) return undefined;
  try {
    const url = await git(["-C", dir, "remote", "get-url", "origin"]);
    return authEnv(url.trim(), token);
  } catch {
    return undefined;
  }
}

/** Ссылка должна быть https — сервер к GitHub не ходит, клонируем локально */
export function assertValidRepoUrl(url: string): void {
  if (!/^https:\/\/[^\s]+$/.test(url) || url.startsWith("-")) {
    throw new Error(t("invalidRepoUrl"));
  }
}

/** Имя ветки без пробелов и ведущего дефиса — защита от подмены аргументов git */
export function assertValidBranch(branch: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error(t("invalidBranch"));
  }
}

/**
 * GIT_CONFIG_* environment variables (our token transport, see authEnv) are
 * honored only by git >= 2.31; older git silently ignores them, so auth to a
 * private repository fails with a cryptic error. Checked once per process,
 * only when a token is actually used.
 */
/** Resolves to the detected too-old version, or undefined when auth may proceed. */
let envAuthCheck: Promise<string | undefined> | undefined;

async function assertEnvAuthSupported(): Promise<void> {
  // Only the detected version is memoized; the error is constructed on every
  // call so its message follows runtime language switches (setLanguage).
  envAuthCheck ??= (async () => {
    let output: string;
    try {
      output = await git(["--version"]);
    } catch {
      // git missing or broken — let the real call surface the proper error
      return undefined;
    }
    const match = output.match(/(\d+)\.(\d+)(?:\.\d+)?/);
    if (!match) return undefined; // unparseable version — do not block, let git try
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major > 2 || (major === 2 && minor >= 31)) return undefined;
    return match[0];
  })();
  const tooOld = await envAuthCheck;
  if (tooOld) throw new Error(t("gitTooOldForTokenAuth", { version: tooOld }));
}

async function git(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  if (env) await assertEnvAuthSupported();
  try {
    const { stdout } = await execFileAsync("git", args, {
      ...GIT_OPTS,
      env: env ? { ...process.env, ...env } : undefined,
    });
    return stdout;
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message: string };
    if (e.code === "ENOENT") throw new Error(t("gitNotAvailable"));
    // Defense in depth: even if a future call site puts the auth header back
    // on the command line, never let its base64 token reach a thrown message
    // (execFile quotes the full argv into e.message when stderr is empty).
    const message = (e.stderr || e.message).trim();
    throw new Error(message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic ***"));
  }
}

/** Список веток и дефолтная ветка публичного/приватного репозитория без клонирования */
export async function listRemoteBranches(
  url: string,
  token?: string,
): Promise<RemoteBranches> {
  assertValidRepoUrl(url);
  let stdout: string;
  try {
    // --symref выводит симссылку HEAD (дефолтная ветка) + все refs; --heads её бы скрыл
    stdout = await git(["ls-remote", "--symref", "--", url], authEnv(url, token));
  } catch (err) {
    throw new Error(t("lsRemoteFailed", { message: (err as Error).message }));
  }

  const branches: string[] = [];
  let defaultBranch = "";
  for (const line of stdout.split("\n")) {
    // Строка симссылки: "ref: refs/heads/main\tHEAD"
    const symref = line.match(/^ref:\s+refs\/heads\/(.+?)\s+HEAD$/);
    if (symref) {
      defaultBranch = symref[1];
      continue;
    }
    // Обычная строка: "<sha>\trefs/heads/<branch>"
    const head = line.match(/refs\/heads\/(.+)$/);
    if (head) branches.push(head[1]);
  }

  if (branches.length === 0) throw new Error(t("lsRemoteFailed", { message: url }));
  if (!defaultBranch || !branches.includes(defaultBranch)) defaultBranch = branches[0];
  return { branches, default: defaultBranch };
}

/** Клонирует репозиторий в указанную папку; пустая ветка — дефолтная ветка репозитория */
export async function cloneRepo(
  url: string,
  branch: string | undefined,
  dir: string,
  token?: string,
): Promise<void> {
  assertValidRepoUrl(url);
  const branchArgs: string[] = [];
  if (branch) {
    assertValidBranch(branch);
    branchArgs.push("--branch", branch);
  }
  try {
    await git(["clone", ...branchArgs, "--", url, dir], authEnv(url, token));
  } catch (err) {
    throw new Error(t("cloneFailed", { message: (err as Error).message }));
  }
}

/** Обновляет клон до свежего состояния ветки на удалённом репозитории */
export async function updateRepo(
  dir: string,
  branch: string,
  token?: string,
): Promise<void> {
  assertValidBranch(branch);
  try {
    await git(["-C", dir, "fetch", "--prune", "origin"], await cloneAuthEnv(dir, token));
    // -B создаёт/сбрасывает локальную ветку на origin/<branch>. -f нужен, когда в ветке
    // появился файл, лежащий в клоне как untracked (plantar.json после настройки
    // деплоя при коммите): без него checkout отказывается его перезаписать.
    // Прочие untracked-файлы -f не трогает, а конфиг деплой всё равно перезапишет.
    await git(["-C", dir, "checkout", "-f", "-B", branch, "--track", `origin/${branch}`]);
    await git(["-C", dir, "reset", "--hard", `origin/${branch}`]);
  } catch (err) {
    throw new Error(t("updateFailed", { message: (err as Error).message }));
  }
}

/** Хеш и сообщение текущего коммита клона */
export async function headCommit(
  dir: string,
): Promise<{ hash: string; message: string }> {
  const stdout = await git(["-C", dir, "log", "-1", "--format=%H%n%s"]);
  const [hash, message = ""] = stdout.trim().split("\n");
  return { hash, message };
}

/**
 * Последние коммиты ветки. Сначала best-effort fetch (чтобы показать и ещё не
 * задеплоенные коммиты), затем лог origin/<branch>. Если сети нет — показываем
 * то, что уже в клоне. Разделители %x1f/новая строка не встречаются в полях.
 */
export async function listCommits(
  dir: string,
  branch: string,
  token?: string,
  limit = 30,
): Promise<GitCommit[]> {
  assertValidBranch(branch);
  try {
    await git(["-C", dir, "fetch", "--prune", "origin"], await cloneAuthEnv(dir, token));
  } catch {
    /* нет сети/доступа — покажем локальную историю клона */
  }

  let ref = `origin/${branch}`;
  try {
    await git(["-C", dir, "rev-parse", "--verify", "--quiet", ref]);
  } catch {
    ref = "HEAD";
  }

  const stdout = await git([
    "-C",
    dir,
    "log",
    ref,
    "-n",
    String(limit),
    "--format=%H%x1f%s%x1f%aI%x1f%an",
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, date, author] = line.split("\x1f");
      return { hash, subject, date, author };
    });
}
