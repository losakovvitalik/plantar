import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { dataDir } from "@plantar/storage";
import { t } from "./i18n";

/**
 * Client ID OAuth-приложения Plantar на GitHub. Это не секрет: в Device Flow
 * client_secret не участвует, поэтому id безопасно распространять в сборке.
 * Через env можно подставить свой для отладки, не трогая код.
 */
const CLIENT_ID = process.env.PLANTAR_GITHUB_CLIENT_ID || "Ov23liSlsSw8sJgHlm1S";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

function tokenFile(): string {
  return path.join(dataDir(), "github-token.enc");
}

function accountFile(): string {
  return path.join(dataDir(), "github-account.json");
}

/** Возвращает токен доступа или null, если вход не выполнен */
export function getToken(): string | null {
  const file = tokenFile();
  if (!existsSync(file)) return null;
  try {
    return safeStorage.decryptString(readFileSync(file));
  } catch {
    return null;
  }
}

export interface GithubAccount {
  login: string;
  /**
   * Токену разрешено менять файлы автодеплоя (.github/workflows) — scope workflow.
   * У входов, сделанных до появления «деплоя при коммите», такого права нет:
   * права токена не меняются задним числом, нужен повторный вход.
   */
  canWriteWorkflows: boolean;
}

/** Как аккаунт лежит на диске: список выданных GitHub прав, а не готовый флаг */
interface StoredAccount {
  login: string;
  scopes?: string[];
}

/** Подключённый аккаунт для показа в настройках; null — вход не выполнен */
export function getAccount(): GithubAccount | null {
  const file = accountFile();
  if (!existsSync(file) || !getToken()) return null;
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as StoredAccount;
    return {
      login: stored.login,
      canWriteWorkflows: stored.scopes?.includes("workflow") ?? false,
    };
  } catch {
    return null;
  }
}

export function signOut(): void {
  rmSync(tokenFile(), { force: true });
  rmSync(accountFile(), { force: true });
}

function storeToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(t("keychainUnavailable"));
  }
  writeFileSync(tokenFile(), safeStorage.encryptString(token), { mode: 0o600 });
}

export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  /** Интервал опроса в секундах */
  interval: number;
  /** Время жизни кода в секундах */
  expiresIn: number;
}

async function postJson(
  url: string,
  body: Record<string, string>,
): Promise<Record<string, string>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(t("githubRequestFailed", { status: res.status }));
  return (await res.json()) as Record<string, string>;
}

/** Шаг 1 Device Flow: получить код для ввода пользователем на github.com */
export async function startDeviceLogin(): Promise<DeviceLogin> {
  // repo — клонирование приватных репозиториев; workflow — коммит файла автодеплоя
  // в .github/workflows (без этого права GitHub отклоняет запись такого файла)
  const data = await postJson(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: "repo workflow" });
  if (!data.device_code) throw new Error(t("githubDeviceFailed"));
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    deviceCode: data.device_code,
    interval: Number(data.interval) || 5,
    expiresIn: Number(data.expires_in) || 900,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Шаг 2 Device Flow: опрашивать GitHub, пока пользователь не подтвердит вход.
 * На успех — сохраняет токен (safeStorage) и логин, возвращает аккаунт.
 */
export async function pollDeviceLogin(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<GithubAccount> {
  const deadline = Date.now() + expiresIn * 1000;
  let waitMs = Math.max(interval, 1) * 1000;

  while (Date.now() < deadline) {
    await sleep(waitMs);
    const data = await postJson(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    if (data.access_token) {
      // GitHub возвращает выданные права строкой вида "repo,workflow"
      const scopes = (data.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const login = await fetchLogin(data.access_token);
      storeToken(data.access_token);
      writeFileSync(accountFile(), JSON.stringify({ login, scopes } satisfies StoredAccount));
      return { login, canWriteWorkflows: scopes.includes("workflow") };
    }

    switch (data.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        waitMs += 5000;
        break;
      case "access_denied":
        throw new Error(t("githubAccessDenied"));
      default:
        throw new Error(t("githubDeviceExpired"));
    }
  }
  throw new Error(t("githubDeviceExpired"));
}

async function fetchLogin(token: string): Promise<string> {
  const res = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(t("githubRequestFailed", { status: res.status }));
  const user = (await res.json()) as { login: string };
  return user.login;
}
