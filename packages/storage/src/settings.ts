import { chmodSync, statSync } from "node:fs";
import path from "node:path";
import { type Language, systemLanguage } from "@plantar/i18n";
import { readJsonSafe, writeJsonAtomic } from "./json-store";
import { dataDir } from "./paths";

export interface AppSettings {
  /** Сохранять локальные копии серверных логов при каждом просмотре */
  saveServerLogCopies: boolean;
  /** Email для Let's Encrypt (уведомления о проблемах с сертификатами); пусто — без email */
  letsEncryptEmail: string;
  /** Показывать системное уведомление об успешном деплое (об ошибке — всегда) */
  notifyOnDeploySuccess: boolean;
  /** Фоновая проверка приложений с уведомлениями о падениях и восстановлениях */
  notifyOnAppDown: boolean;
  /** Язык интерфейса */
  language: Language;
  /** Local MCP endpoint for AI agents (read-only unless mcpAllowDeploy); off by default */
  mcpServerEnabled: boolean;
  /** Let MCP agents start deploys and rollbacks; a separate opt-in on top of
   *  mcpServerEnabled — with it off the endpoint stays read-only */
  mcpAllowDeploy: boolean;
  /** Bearer token of the MCP endpoint; generated on first enable. It is
   *  self-sufficient — with mcpAllowDeploy on it grants deploys on every
   *  configured server — so settings.json is kept readable by its owner
   *  only, see SETTINGS_FILE_MODE */
  mcpServerToken: string;
  /** TCP port of the MCP endpoint; 0 — the default port (MCP_PORT from
   *  `@plantar/mcp/meta`, not importable here without a dependency cycle).
   *  When that port turns out taken, the listener falls back to a free one
   *  and the app persists it here, so the address survives restarts */
  mcpServerPort: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  saveServerLogCopies: true,
  letsEncryptEmail: "",
  notifyOnDeploySuccess: true,
  notifyOnAppDown: true,
  language: systemLanguage(),
  mcpServerEnabled: false,
  mcpAllowDeploy: false,
  mcpServerToken: "",
  mcpServerPort: 0,
};

/** settings.json holds the MCP access token, so unlike the other stores it
 *  must not be world-readable — neither the file nor the temp file it is
 *  written through (POSIX only; Windows does not map these bits) */
const SETTINGS_FILE_MODE = 0o600;

export function readSettings(): AppSettings {
  const file = path.join(dataDir(), "settings.json");
  // Upgrade path: installs from before the 0600 policy wrote the file
  // world-readable. Tightening on read covers them without any extra wiring —
  // both the app and the CLI read settings on startup. The .broken recovery
  // copy holds the same token, so a pre-policy copy is tightened too; a copy
  // made after the policy is already tight — copyFileSync preserves the mode
  // of the source, which is healed here before the copy could be taken.
  if (process.platform !== "win32") {
    for (const f of [file, `${file}.broken`]) {
      try {
        if (statSync(f).mode & 0o077) chmodSync(f, SETTINGS_FILE_MODE);
      } catch {
        // no file yet, or the file is not ours to fix — reading decides below
      }
    }
  }
  return { ...DEFAULT_SETTINGS, ...readJsonSafe<Partial<AppSettings>>(file, {}) };
}

export function writeSettings(settings: AppSettings): void {
  writeJsonAtomic(path.join(dataDir(), "settings.json"), settings, SETTINGS_FILE_MODE);
}
