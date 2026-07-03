import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const projectConfigSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "только строчные латинские буквы, цифры и дефис",
    ),
  /** Тип проекта; в MVP поддерживаются только статические сайты */
  type: z.enum(["static"]).default("static"),
  packageManager: z.enum(PACKAGE_MANAGERS).default("npm"),
  buildCommand: z.string().default("npm run build"),
  buildDir: z.string().default("dist"),
  /** Порт приложения; статические сайты его не используют */
  port: z.number().int().min(1).max(65535).optional(),
  /** Домен сайта; если не указан — сайт отвечает по IP сервера */
  domain: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectConfigInput = z.input<typeof projectConfigSchema>;

function parseConfig(raw: unknown): ProjectConfig {
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(корень)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`plantar.json — ошибки конфигурации:\n${issues}`);
  }
  return parsed.data;
}

export function hasProjectConfig(projectDir: string): boolean {
  return existsSync(path.join(projectDir, "plantar.json"));
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const file = path.join(projectDir, "plantar.json");
  if (!existsSync(file)) {
    throw new Error(`Не найден plantar.json в ${projectDir}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`plantar.json — некорректный JSON: ${(err as Error).message}`);
  }

  return parseConfig(raw);
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
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson | null {
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

/** Предзаполняет конфиг проекта по package.json и lockfile */
export function detectProjectConfig(projectDir: string): DetectedProject {
  const pkg = readPackageJson(projectDir);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  let framework: string | null = null;
  let buildDir = "dist";
  if (deps.vite) {
    framework = "Vite";
  } else if (deps["react-scripts"]) {
    framework = "Create React App";
    buildDir = "build";
  }

  const packageManager = detectPackageManager(projectDir, pkg);
  const buildCommand = pkg?.scripts?.build
    ? `${packageManager} run build`
    : "npm run build";

  // Имя: из package.json (без scope) или из названия папки
  const name =
    sanitizeName((pkg?.name ?? "").replace(/^@[^/]+\//, "")) ||
    sanitizeName(path.basename(projectDir)) ||
    "my-app";

  return {
    config: { name, packageManager, buildCommand, buildDir },
    framework,
  };
}
