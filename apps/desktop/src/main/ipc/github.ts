import { readFileSync } from "node:fs";
import path from "node:path";
import { loadProjectConfig } from "@plantar/config";
import { type ProjectRecord, readProjects, writeProjects } from "@plantar/storage";
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
  hasDeployWorkflow,
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
  // landing on another key of the same server the moment it holds one. Read off
  // the connection the operation ran on rather than looked up in the records,
  // so — unlike a lookup — it cannot come up empty: a connection that carried
  // these commands was established by checking that very key.
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

  // The record is the only local trace that deploy on commit exists. The trust
  // dialog reads it to name the projects whose GitHub copy of the host key is
  // left behind when a reinstalled server's new key gets trusted. Written last:
  // a setup that failed halfway left no working deploy on commit to warn about
  writeProjects(
    readProjects().map((p) => (p.id === project.id ? { ...p, deployOnCommit: true } : p)),
  );

  return {
    branch: project.branch,
    actionsUrl: `https://github.com/${repo.owner}/${repo.repo}/actions`,
  };
}

/**
 * Gives the server's git projects the deploy-on-commit marker they earned
 * before the app started recording it, and answers with the projects as they
 * stand afterwards. Asked by the trust-host-key dialog, which is about to name
 * the marked projects: without this, a deploy on commit set up by an older
 * version reads as never set up, and the very users the warning was built for
 * would trust a reinstalled server's new key with no hint that their
 * push-triggered deploys keep checking against the previous one.
 *
 * The evidence is the workflow file a completed setup commits to the project's
 * branch. Keeping the bias the marker's write-last placement in
 * `setupGithubActions` has, only positive evidence writes: no GitHub login, a
 * repository without the file, one that answers not at all — the record is left
 * as it is, and the marker is never cleared.
 *
 * That evidence belongs to the repository while the marker belongs to the
 * project, and the two cannot be separated: the workflow lives at one fixed
 * path, so two projects of the same repository and branch (a monorepo split by
 * subdir) both read as set up and both get marked. The stale host key is in
 * that repository's secrets either way, and one workflow file per repository
 * means only one of those projects can have a working deploy on commit at all,
 * so this names one project too many rather than warning about nothing.
 */
async function backfillDeployOnCommitFromGithub(serverId: string): Promise<ProjectRecord[]> {
  const token = getToken();
  // Nothing to check the repositories with: the dialog still warns about the
  // projects that carry the marker already
  if (!token) return readProjects();
  const candidates = readProjects().filter(
    (p) =>
      p.serverId === serverId &&
      p.source === "git" &&
      p.repoUrl &&
      p.branch &&
      !p.deployOnCommit,
  );
  // Asked all at once: the checks are independent, and none of them carries a
  // timeout of its own — one address that swallows the request would otherwise
  // hold back the checks after it, and with them the note the dialog is about
  // to show. A check answers rather than throws, so nothing here can reject
  const answers = await Promise.all(
    candidates.map(async (p) => ({
      id: p.id,
      found: await hasDeployWorkflow(token, p.repoUrl!, p.branch!),
    })),
  );
  const marked = new Set(answers.filter((a) => a.found).map((a) => a.id));
  if (marked.size === 0) return readProjects();
  // Read again instead of writing back the list the candidates came from: the
  // checks above went to the network, and whatever happened to the records
  // meanwhile is in the file rather than in that snapshot
  const projects = readProjects().map((p) =>
    marked.has(p.id) ? { ...p, deployOnCommit: true } : p,
  );
  writeProjects(projects);
  return projects;
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
  // Marks the server's setups made before the marker existed and answers with
  // the projects — what the trust-host-key dialog reads its warning from
  handle("github:backfillDeployOnCommit", (_e, serverId) =>
    toResult(() => backfillDeployOnCommitFromGithub(serverId)),
  );
}
