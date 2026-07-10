import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);

/** Строки git-вывода бывают большими (история, файлы) — поднимаем лимит буфера */
const GIT_OPTS = { maxBuffer: 32 * 1024 * 1024 } as const;

/**
 * Аргументы аутентификации для git: токен передаётся заголовком Authorization
 * через `-c http.extraHeader`, а не в URL — чтобы он не оседал в .git/config.
 * Заголовок виден только на время вызова git и только процессу git.
 */
function authArgs(token?: string): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

/** Ссылка должна быть https — сервер к GitHub не ходит, клонируем локально */
export function assertValidRepoUrl(url: string): void {
  if (!/^https:\/\/[^\s]+$/.test(url) || url.startsWith("-")) {
    throw new Error(t("invalidRepoUrl"));
  }
}

/** Имя ветки без пробелов и ведущего дефиса — защита от подмены аргументов git */
function assertValidBranch(branch: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error(t("invalidBranch"));
  }
}

async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, GIT_OPTS);
    return stdout;
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message: string };
    if (e.code === "ENOENT") throw new Error(t("gitNotAvailable"));
    throw new Error((e.stderr || e.message).trim());
  }
}

export interface RemoteBranches {
  branches: string[];
  /** Дефолтная ветка репозитория (HEAD) */
  default: string;
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
    stdout = await git([...authArgs(token), "ls-remote", "--symref", "--", url]);
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
    await git([...authArgs(token), "clone", ...branchArgs, "--", url, dir]);
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
    await git([...authArgs(token), "-C", dir, "fetch", "--prune", "origin"]);
    // -B создаёт/сбрасывает локальную ветку на origin/<branch>; untracked-файлы (plantar.json) не трогаются
    await git(["-C", dir, "checkout", "-B", branch, "--track", `origin/${branch}`]);
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

export interface Commit {
  hash: string;
  subject: string;
  /** ISO-дата коммита */
  date: string;
  author: string;
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
): Promise<Commit[]> {
  assertValidBranch(branch);
  try {
    await git([...authArgs(token), "-C", dir, "fetch", "--prune", "origin"]);
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
