import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { t } from "./messages";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

// Фабрика, а не константа: сообщения об ошибках должны браться на момент
// парсинга — язык устанавливается приложением после импорта модуля
const projectConfigSchema = () =>
  z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, t("nameRegex")),
    /** Тип проекта: статический сайт, Node.js/Next.js-приложение или Telegram-бот */
    type: z.enum(["static", "node", "next", "bot"]).default("static"),
    /** Рантайм бота; python — зависимости из requirements.txt в venv */
    runtime: z.enum(["node", "python"]).default("node"),
    packageManager: z.enum(PACKAGE_MANAGERS).default("npm"),
    /** npm: ставить зависимости с --legacy-peer-deps (конфликт версий, подтверждён пользователем) */
    legacyPeerDeps: z.boolean().optional(),
    buildCommand: z.string().default("npm run build"),
    buildDir: z.string().default("dist"),
    /** Команда запуска Node.js-приложения; статические сайты её не используют */
    startCommand: z.string().optional(),
    /** Порт Node.js-приложения; назначается автоматически при первом деплое */
    port: z.number().int().min(1).max(65535).optional(),
    /** Домен сайта; если не указан — сайт отвечает по IP сервера.
     * Regex также защищает от инъекции в shell-команды деплоя (certbot, nginx) */
    domain: z
      .string()
      .regex(/^[a-z0-9.-]+$/i, t("domainRegex"))
      .optional(),
  });

export type ProjectConfig = z.infer<ReturnType<typeof projectConfigSchema>>;
export type ProjectConfigInput = z.input<ReturnType<typeof projectConfigSchema>>;

function parseConfig(raw: unknown): ProjectConfig {
  const parsed = projectConfigSchema().safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || t("issueRoot")}: ${issue.message}`)
      .join("\n");
    throw new Error(t("configInvalid", { issues }));
  }
  return parsed.data;
}

/** Валидирует конфиг без файла — настройки импортированного проекта живут в записи проекта */
export function parseProjectConfig(input: ProjectConfigInput): ProjectConfig {
  return parseConfig(input);
}

export function hasProjectConfig(projectDir: string): boolean {
  return existsSync(path.join(projectDir, "plantar.json"));
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const file = path.join(projectDir, "plantar.json");
  if (!existsSync(file)) {
    throw new Error(t("configNotFound", { dir: projectDir }));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(t("configBadJson", { message: (err as Error).message }));
  }

  const config = parseConfig(raw);

  // До появления поддержки Next.js он автоопределялся как обычная статика с dist.
  // Читаем такой старый конфиг как Next.js; явный static-export с другим buildDir
  // остаётся статическим. При первом успешном desktop-деплое тип сохранится вместе с портом.
  if (
    config.type === "static" &&
    config.buildDir === "dist" &&
    !config.startCommand
  ) {
    const detected = detectProjectConfig(projectDir).config;
    if (detected.type === "next") {
      return {
        ...config,
        type: "next",
        startCommand: detected.startCommand,
      };
    }
  }

  return config;
}

export function writeProjectConfig(
  projectDir: string,
  input: ProjectConfigInput,
): ProjectConfig {
  const config = parseConfig(input);
  writeFileSync(
    path.join(projectDir, "plantar.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
  return config;
}

/** Результат автоопределения конфига по файлам проекта */
export interface DetectedProject {
  config: ProjectConfigInput;
  /** Название фреймворка для показа в UI; null — не распознан */
  framework: string | null;
}

interface PackageJson {
  name?: string;
  main?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function readPackageJson(dir: string): PackageJson | null {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

const LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

function detectPackageManager(dir: string, pkg: PackageJson | null): PackageManager {
  for (const [file, manager] of LOCKFILES) {
    if (existsSync(path.join(dir, file))) return manager;
  }
  // Поле packageManager в package.json, например "pnpm@9.0.0"
  const fromField = pkg?.packageManager?.split("@")[0];
  if (PACKAGE_MANAGERS.includes(fromField as PackageManager)) {
    return fromField as PackageManager;
  }
  return "npm";
}

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Серверные фреймворки ищем только в dependencies: в devDependencies
// они не означают, что сам проект — сервер
const NODE_FRAMEWORKS: Array<[dep: string, label: string]> = [
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["@nestjs/core", "NestJS"],
  ["hono", "Hono"],
];

// Библиотеки Telegram-ботов; проверяются раньше серверных фреймворков
const BOT_FRAMEWORKS: Array<[dep: string, label: string]> = [
  ["grammy", "grammY"],
  ["telegraf", "Telegraf"],
  ["node-telegram-bot-api", "node-telegram-bot-api"],
];

// Библиотеки Python-ботов; ищутся в requirements.txt и pyproject.toml
const PYTHON_BOT_LIBS: Array<[dep: string, label: string]> = [
  ["aiogram", "aiogram"],
  ["python-telegram-bot", "python-telegram-bot"],
  ["pytelegrambotapi", "pyTelegramBotAPI"],
];

const PYTHON_MAIN_FILES = ["bot.py", "main.py", "app.py"];

function detectPythonBot(projectDir: string, name: string): DetectedProject | null {
  const text = ["requirements.txt", "pyproject.toml"]
    .map((file) => path.join(projectDir, file))
    .filter(existsSync)
    .map((file) => readFileSync(file, "utf8").toLowerCase())
    .join("\n");
  const lib = PYTHON_BOT_LIBS.find(([dep]) => text.includes(dep));
  if (!lib) return null;

  const main =
    PYTHON_MAIN_FILES.find((file) => existsSync(path.join(projectDir, file))) ?? "main.py";
  return {
    config: { name, type: "bot", runtime: "python", startCommand: `python ${main}` },
    framework: lib[1],
  };
}

/** Предзаполняет конфиг проекта по package.json и lockfile */
export function detectProjectConfig(projectDir: string): DetectedProject {
  const pkg = readPackageJson(projectDir);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const packageManager = detectPackageManager(projectDir, pkg);

  // Имя: из package.json (без scope) или из названия папки
  const name =
    sanitizeName((pkg?.name ?? "").replace(/^@[^/]+\//, "")) ||
    sanitizeName(path.basename(projectDir)) ||
    "my-app";

  const pythonBot = detectPythonBot(projectDir, name);
  if (pythonBot) return pythonBot;

  const botFramework = BOT_FRAMEWORKS.find(([dep]) => pkg?.dependencies?.[dep]);
  if (botFramework) {
    const startCommand = pkg?.scripts?.start
      ? `${packageManager} start`
      : pkg?.main
        ? `node ${pkg.main}`
        : `${packageManager} start`;
    return {
      config: { name, packageManager, type: "bot", startCommand },
      framework: botFramework[1],
    };
  }

  if (deps.next) {
    return {
      config: {
        name,
        packageManager,
        type: "next",
        buildCommand: `${packageManager} run build`,
        startCommand: `${packageManager} start`,
      },
      framework: "Next.js",
    };
  }

  const nodeFramework = NODE_FRAMEWORKS.find(([dep]) => pkg?.dependencies?.[dep]);
  if (nodeFramework) {
    const startCommand = pkg?.scripts?.start
      ? `${packageManager} start`
      : pkg?.main
        ? `node ${pkg.main}`
        : `${packageManager} start`;
    return {
      config: {
        name,
        packageManager,
        type: "node",
        startCommand,
      },
      framework: nodeFramework[1],
    };
  }

  let framework: string | null = null;
  let buildDir = "dist";
  if (deps.vite) {
    framework = "Vite";
  } else if (deps["react-scripts"]) {
    framework = "Create React App";
    buildDir = "build";
  }

  const buildCommand = pkg?.scripts?.build
    ? `${packageManager} run build`
    : "npm run build";

  return {
    config: { name, packageManager, type: "static", buildCommand, buildDir },
    framework,
  };
}
