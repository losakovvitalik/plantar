import path from "node:path";
import type { DeployRecord } from "./history";
import { readJsonSafe, writeJsonAtomic } from "./json-store";
import { dataDir } from "./paths";

/** Коммит в кэше вкладки «Коммиты» (совпадает по форме с Commit из main/git.ts) */
export interface CachedCommit {
  hash: string;
  subject: string;
  date: string;
  author: string;
}

/** Снимок вкладки «Коммиты» одного проекта: список коммитов + статусы деплоев */
export interface CommitsCacheEntry {
  commits: CachedCommit[];
  history: DeployRecord[];
  cachedAt: string;
}

function commitsCacheFile(): string {
  return path.join(dataDir(), "commits-cache.json");
}

/** Кэш вкладки «Коммиты» по projectId — для мгновенного показа при открытии */
export function readCommitsCache(): Record<string, CommitsCacheEntry> {
  return readJsonSafe<Record<string, CommitsCacheEntry>>(commitsCacheFile(), {});
}

export function writeCommitsCache(cache: Record<string, CommitsCacheEntry>): void {
  writeJsonAtomic(commitsCacheFile(), cache);
}

/** Статус приложения на сервере: pm2-процесс + HTTP-проверка сайта.
 *  unresponsive — процесс/статика на месте, но сайт не отвечает;
 *  static — статичный сайт, который ещё не проверялся (не был задеплоен) */
export type AppStatus = "running" | "stopped" | "error" | "unresponsive" | "static";

/** Снимок статусов приложений одного сервера */
export interface AppStatusEntry {
  /** projectId → статус */
  apps: Record<string, AppStatus>;
  checkedAt: string;
}

function appStatusCacheFile(): string {
  return path.join(dataDir(), "app-status-cache.json");
}

/** Кэш статусов приложений по serverId — для мгновенного показа при открытии */
export function readAppStatusCache(): Record<string, AppStatusEntry> {
  return readJsonSafe<Record<string, AppStatusEntry>>(appStatusCacheFile(), {});
}

export function writeAppStatusCache(cache: Record<string, AppStatusEntry>): void {
  writeJsonAtomic(appStatusCacheFile(), cache);
}

/** Кэш вкладки «Статус» одного проекта; форму полей задаёт вкладка (desktop),
 *  хранилище их не интерпретирует. Поля пишутся независимо — каждая карточка
 *  сохраняет своё по мере загрузки */
export interface StatusTabCacheEntry {
  snapshot?: unknown;
  metricsHistory?: unknown;
  logActivity?: unknown;
  cachedAt: string;
}

function statusTabCacheFile(): string {
  return path.join(dataDir(), "status-tab-cache.json");
}

/** Кэш вкладки «Статус» по projectId — для мгновенного показа при открытии */
export function readStatusTabCache(): Record<string, StatusTabCacheEntry> {
  return readJsonSafe<Record<string, StatusTabCacheEntry>>(statusTabCacheFile(), {});
}

export function writeStatusTabCache(cache: Record<string, StatusTabCacheEntry>): void {
  writeJsonAtomic(statusTabCacheFile(), cache);
}
