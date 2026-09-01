import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit, RemoteBranches } from "../shared/ipc";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);

/** Строки git-вывода бывают большими (история, файлы) — поднимаем лимит буфера */
const GIT_OPTS = { maxBuffer: 32 * 1024 * 1024 } as const;

/** The hosts that are GitHub itself. `www.github.com` is the same origin; it
 *  serves nothing of its own, only a redirect (see canonicalRepoUrl). */
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

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
    return protocol === "https:" && GITHUB_HOSTS.has(hostname);
  } catch {
    return false; // not even a URL — certainly not GitHub
  }
}

/**
 * `www.github.com` is GitHub, but it hosts nothing: every git request there is
 * answered with a 301 to the apex host. Authenticated calls run with redirects
 * switched off (see authEnv), so a link pasted with `www.` would fail on a
 * redirect git is not allowed to follow. Send git to `github.com` instead —
 * the same repository, with no redirect in the way.
 *
 * The guard is isGithubUrl, so the rewrite fires only while GITHUB_HOSTS still
 * lists `www.github.com`: dropping the host from that set turns this function
 * into a no-op, which makes it a decision to take here as well.
 */
function canonicalRepoUrl(url: string): string {
  if (!isGithubUrl(url)) return url;
  const parsed = new URL(url);
  if (parsed.hostname !== "www.github.com") return url;
  parsed.hostname = "github.com";
  return parsed.toString();
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
 * The one entry point for aiming git at a repository URL: canonicalises the
 * URL and builds the auth env for the canonical form, as an inseparable pair.
 * Hand git `target` and `env` together. A call site pairing canonicalRepoUrl
 * with authEnv by hand could build the env yet give git the raw URL — sending
 * the header to the redirecting `www.` host, where the refused redirect would
 * then be misreported as a moved repository.
 */
function githubTarget(
  url: string,
  token?: string,
): { target: string; env?: NodeJS.ProcessEnv } {
  const target = canonicalRepoUrl(url);
  return { target, env: authEnv(target, token) };
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
    const url = (await git(["-C", dir, "remote", "get-url", "origin"])).trim();
    // The URL never reaches git here (the fetch names the remote, and git
    // resolves it from the clone's config), so unlike the call sites that
    // hand git a URL there is no canonical form to pair the env with —
    // authEnv alone answers the one question this helper asks: is the host
    // GitHub? `www.github.com` is (see GITHUB_HOSTS), stale remote or not.
    // On a stale `www.` remote the token comes with a catch, though: authEnv
    // also pins http.followRedirects=false, and `www.` answers only with a
    // 301, so an authenticated read — the best-effort fetch in listCommits —
    // degrades to the clone's local history until the next update repoints
    // the remote. If that degradation ever matters, keep reads read-only via
    // a per-invocation override:
    // `git -C <dir> -c remote.origin.url=<canonical> fetch --prune origin`.
    return authEnv(url, token);
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

/**
 * A refused redirect, as git reports it: `fatal: unable to access '<url>': The
 * requested URL returned error: 301`. The status code is only ever in the text
 * — execFile hands back git's own exit code, which is the same for every
 * network failure.
 */
const REDIRECT_STATUS = /requested URL returned error:\s*3\d\d/i;

/**
 * Whether the call ran with redirects switched off, read from the env itself
 * (the pair authEnv sets). The moved-repository explanation below depends on
 * exactly this fact, so the mere presence of an extra env is no proxy for it:
 * an env added later for an unrelated reason would then turn every 3xx into
 * the wrong explanation. The declared pairs are scanned the way git reads
 * them (GIT_CONFIG_COUNT), so the answer does not depend on where authEnv
 * happens to put the pair.
 */
function redirectsDisabled(env?: NodeJS.ProcessEnv): boolean {
  if (!env) return false;
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  for (let i = 0; i < count; i++) {
    if (
      env[`GIT_CONFIG_KEY_${i}`] === "http.followRedirects" &&
      env[`GIT_CONFIG_VALUE_${i}`] === "false"
    ) {
      return true;
    }
  }
  return false;
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
    const message = (e.stderr || e.message)
      .trim()
      .replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic ***");
    // Only a call with redirects switched off sees a repository that GitHub
    // has moved (renamed or handed to another owner) come back as a bare
    // status code. Explain it, and keep git's own line after the explanation:
    // a 3xx that is something else (a proxy, a captive portal) would otherwise
    // be reported as a move with no trace of what actually answered. The line
    // kept is the scrubbed one, and this branch is reached only for a URL
    // isGithubUrl accepted, which carries no credentials of its own.
    if (redirectsDisabled(env) && REDIRECT_STATUS.test(message)) {
      throw new Error(t("repoMoved", { message }));
    }
    throw new Error(message);
  }
}

/** Список веток и дефолтная ветка публичного/приватного репозитория без клонирования */
export async function listRemoteBranches(
  url: string,
  token?: string,
): Promise<RemoteBranches> {
  assertValidRepoUrl(url);
  const { target, env } = githubTarget(url, token);
  let stdout: string;
  try {
    // --symref выводит симссылку HEAD (дефолтная ветка) + все refs; --heads её бы скрыл
    stdout = await git(["ls-remote", "--symref", "--", target], env);
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
  // The clone stores this URL as its origin, so canonicalising it here is also
  // what keeps every later fetch away from the redirecting host.
  const { target, env } = githubTarget(url, token);
  const branchArgs: string[] = [];
  if (branch) {
    assertValidBranch(branch);
    branchArgs.push("--branch", branch);
  }
  try {
    await git(["clone", ...branchArgs, "--", target, dir], env);
  } catch (err) {
    throw new Error(t("cloneFailed", { message: (err as Error).message }));
  }
}

/**
 * A clone made from a `www.github.com` link (before cloneRepo started
 * canonicalising its target) stores a remote that answers every request with
 * a redirect an authenticated call may not follow. Repoint it at the apex
 * host once, so every later call reaches GitHub directly. An update is the
 * one moment the app deliberately rewrites the clone, which is why this runs
 * from updateRepo and nowhere else — read-shaped calls (listCommits,
 * cloneAuthEnv) must leave the clone untouched.
 *
 * Best effort: whether the token is attached is a decision about the host
 * (cloneAuthEnv), and it must not hinge on whether this write succeeded, so
 * a failure here only skips the repoint and the update's own git calls
 * report whatever is actually wrong with the clone.
 */
async function repointToCanonicalOrigin(dir: string): Promise<void> {
  try {
    const url = (await git(["-C", dir, "remote", "get-url", "origin"])).trim();
    const target = canonicalRepoUrl(url);
    if (target !== url) {
      await git(["-C", dir, "remote", "set-url", "origin", target]);
    }
  } catch {
    /* no readable origin, or the config write failed — see the docblock */
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
    await repointToCanonicalOrigin(dir);
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
