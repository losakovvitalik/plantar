import { readFileSync } from "node:fs";
import path from "node:path";
import { loadProjectConfig } from "@plantar/config";
import { withServer } from "../connections";
import { assertValidBranch } from "../git";
import {
  getAccount,
  getToken,
  pollDeviceLogin,
  signOut,
  startDeviceLogin,
} from "../github";
import {
  WORKFLOW_PATH,
  buildWorkflowYaml,
  commitFiles,
  fetchSecretsPublicKey,
  parseGithubRepo,
  putSecrets,
} from "../github-actions";
import { t } from "../i18n";
import { getProject, getServer, projectDir } from "../records";
import { generateKeyPair, installPublicKey, removeKeysWithComment } from "../ssh-setup";
import { handle, toResult } from "./util";

/**
 * Настраивает деплой при коммите: генерирует отдельный deploy-ключ (личный ключ
 * пользователя не используется), устанавливает его на сервер, кладёт ключ и адрес
 * сервера в Secrets репозитория и коммитит workflow + plantar.json в ветку проекта.
 * Ключ и адрес уходят в GitHub Secrets — осознанное исключение из local-first (README).
 */
async function setupGithubActions(
  projectId: string,
  password: string | undefined,
): Promise<{ branch: string; actionsUrl: string }> {
  const project = getProject(projectId);
  if (project.source !== "git" || !project.repoUrl || !project.branch) {
    throw new Error(t("actionsGitOnly"));
  }
  const token = getToken();
  const account = getAccount();
  if (!token || !account) throw new Error(t("actionsLoginRequired"));
  // Без права workflow GitHub отклонит коммит файла автодеплоя — проверяем до правок
  if (!account.canWriteWorkflows) throw new Error(t("actionsScopeMissing"));
  assertValidBranch(project.branch);
  const repo = parseGithubRepo(project.repoUrl);
  const server = getServer(project.serverId);
  const dir = projectDir(project);
  const config = loadProjectConfig(dir);

  // Ключ шифрования секретов доступен только администратору репозитория: запрашиваем
  // его первым, чтобы при нехватке прав не оставить на сервере лишний ключ
  const secretsKey = await fetchSecretsPublicKey(token, repo);

  // Ключ проекта опознаётся по комментарию: прежний снимаем — его приватная
  // половина лежала в секретах репозитория и больше не должна открывать сервер
  const comment = `plantar-ci-${config.name}`;
  const { privateKeyPem, publicKey } = await generateKeyPair(
    `github-actions-${project.id}`,
    comment,
  );
  // The host key goes into the secrets too: a CI deploy has nobody to ask and
  // no records of its own, so an unpinned run would upload the project to
  // whatever answers at that address. What gets pinned is the key of this very
  // connection — the key the app has just checked the server by. Its type is
  // pinned with it: this connection asked for the recorded type first, and a CI
  // run given the fingerprint alone would let its ssh library pick the type,
  // landing on another key of the same server the moment it holds one. Taken
  // inside the operation, before the keys are touched: giving up here leaves
  // authorized_keys as it was — the same ordering rule as the secrets key above.
  const hostKey = await withServer(server, password, async (conn) => {
    await removeKeysWithComment(conn, comment);
    await installPublicKey(conn, publicKey);
    return conn.hostKey;
  });

  await putSecrets(token, repo, secretsKey, {
    PLANTAR_SSH_KEY: privateKeyPem,
    PLANTAR_HOST: server.host,
    PLANTAR_PORT: String(server.port),
    PLANTAR_USER: server.user,
    PLANTAR_HOST_KEY: hostKey.fingerprint,
    PLANTAR_HOST_KEY_TYPE: hostKey.type,
  });

  // plantar.json лежит в клоне untracked — без него CI не поймёт, как деплоить
  const configPath = project.subdir ? `${project.subdir}/plantar.json` : "plantar.json";
  await commitFiles(
    token,
    repo,
    project.branch,
    [
      { path: WORKFLOW_PATH, content: buildWorkflowYaml(project.branch, config, project.subdir) },
      { path: configPath, content: readFileSync(path.join(dir, "plantar.json"), "utf8") },
    ],
    "ci: deploy with Plantar on push",
  );

  return {
    branch: project.branch,
    actionsUrl: `https://github.com/${repo.owner}/${repo.repo}/actions`,
  };
}

export function registerGithubIpc(): void {
  // GitHub Device Flow: вход без backend, токен шифруется safeStorage
  handle("github:account", () => toResult(async () => getAccount()));
  handle("github:startLogin", () => toResult(() => startDeviceLogin()));
  handle(
    "github:pollLogin",
    (_e, args) =>
      toResult(() => pollDeviceLogin(args.deviceCode, args.interval, args.expiresIn)),
  );
  handle("github:signOut", () => toResult(async () => signOut()));
  // Автонастройка деплоя при коммите: deploy-ключ → Secrets, workflow → в ветку
  handle("github:setupActions", (_e, args) =>
    toResult(() => setupGithubActions(args.projectId, args.password)),
  );
}
