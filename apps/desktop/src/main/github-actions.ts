import sodium from "libsodium-wrappers";
import type { ProjectConfig } from "@plantar/config";
import { shellQuote } from "@plantar/ssh";
import { t } from "./i18n";

/** Путь workflow-файла в репозитории пользователя */
export const WORKFLOW_PATH = ".github/workflows/plantar-deploy.yml";

export interface GithubRepo {
  owner: string;
  repo: string;
}

/** Разбирает https-ссылку на репозиторий GitHub; другие хосты не поддерживаются */
export function parseGithubRepo(repoUrl: string): GithubRepo {
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(repoUrl);
  if (!match) throw new Error(t("actionsGithubOnly"));
  return { owner: match[1], repo: match[2] };
}

/** Запрос к GitHub REST API; ошибки — локализованные, с message из ответа GitHub */
async function api<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Запись секрета отвечает пустым телом (201/204), остальные ручки — JSON
  const text = await res.text();
  if (!res.ok) {
    let message = "";
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? "";
    } catch {
      /* тело не JSON — показываем только код */
    }
    throw new Error(t("actionsApiFailed", { status: res.status, message }));
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Публичный ключ репозитория, которым шифруются его секреты */
export interface SecretsPublicKey {
  key_id: string;
  key: string;
}

/** Требует прав администратора репозитория — запрашиваем до изменений на сервере */
export function fetchSecretsPublicKey(
  token: string,
  { owner, repo }: GithubRepo,
): Promise<SecretsPublicKey> {
  return api<SecretsPublicKey>(
    token,
    "GET",
    `/repos/${owner}/${repo}/actions/secrets/public-key`,
  );
}

/**
 * Записывает секреты репозитория (Actions). GitHub принимает значения только
 * зашифрованными публичным ключом репозитория (libsodium sealed box).
 */
export async function putSecrets(
  token: string,
  { owner, repo }: GithubRepo,
  key: SecretsPublicKey,
  secrets: Record<string, string>,
): Promise<void> {
  await sodium.ready;
  const publicKey = sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL);
  for (const [name, value] of Object.entries(secrets)) {
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), publicKey);
    await api(token, "PUT", `/repos/${owner}/${repo}/actions/secrets/${name}`, {
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id: key.key_id,
    });
  }
}

export interface CommitFile {
  path: string;
  content: string;
}

/**
 * Добавляет/обновляет файлы в ветке одним коммитом (Git Data API).
 * Если содержимое не изменилось — коммит не создаётся.
 */
export async function commitFiles(
  token: string,
  { owner, repo }: GithubRepo,
  branch: string,
  files: CommitFile[],
  message: string,
): Promise<{ changed: boolean }> {
  const base = `/repos/${owner}/${repo}/git`;
  // Имя ветки проверено при добавлении проекта ([A-Za-z0-9._/-]+) — в URL безопасно
  const ref = await api<{ object: { sha: string } }>(token, "GET", `${base}/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const headCommit = await api<{ tree: { sha: string } }>(
    token,
    "GET",
    `${base}/commits/${headSha}`,
  );
  const tree = await api<{ sha: string }>(token, "POST", `${base}/trees`, {
    base_tree: headCommit.tree.sha,
    tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
  });
  if (tree.sha === headCommit.tree.sha) return { changed: false };
  const commit = await api<{ sha: string }>(token, "POST", `${base}/commits`, {
    message,
    tree: tree.sha,
    parents: [headSha],
  });
  await api(token, "PATCH", `${base}/refs/heads/${branch}`, { sha: commit.sha });
  return { changed: true };
}

/**
 * Текст workflow-файла: на push в ветку проекта ставит @plantar/cli из npm
 * и деплоит через `plantar deploy`, ключ и адрес сервера — из Secrets.
 */
export function buildWorkflowYaml(
  branch: string,
  config: ProjectConfig,
  subdir?: string,
): string {
  // Статические сайты собираются на CI-машине — нужен пакетный менеджер проекта;
  // node/bot собираются на сервере, там достаточно npm для установки CLI
  const needsPm = config.type === "static" ? config.packageManager : "npm";
  const pmStep =
    needsPm === "pnpm" || needsPm === "yarn"
      ? `      - run: npm install -g ${needsPm}\n\n`
      : needsPm === "bun"
        ? "      - uses: oven-sh/setup-bun@v2\n\n"
        : "";
  const project = shellQuote(subdir || ".");

  return `# Created by Plantar — deploys the project to your server on every push.
# Server address and deploy key live in the repository secrets (PLANTAR_*).
name: Plantar deploy

on:
  push:
    branches: ["${branch}"]

concurrency:
  group: plantar-deploy-${config.name}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

${pmStep}      - run: npm install -g @plantar/cli

      - name: Deploy
        run: |
          umask 077
          printf '%s\\n' "$PLANTAR_SSH_KEY" > "$RUNNER_TEMP/deploy-key"
          plantar deploy --host "$PLANTAR_HOST" --port "$PLANTAR_PORT" --user "$PLANTAR_USER" --key "$RUNNER_TEMP/deploy-key" --project ${project}
        env:
          PLANTAR_SSH_KEY: \${{ secrets.PLANTAR_SSH_KEY }}
          PLANTAR_HOST: \${{ secrets.PLANTAR_HOST }}
          PLANTAR_PORT: \${{ secrets.PLANTAR_PORT }}
          PLANTAR_USER: \${{ secrets.PLANTAR_USER }}
`;
}
