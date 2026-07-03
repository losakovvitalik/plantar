import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const projectConfigSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "только строчные латинские буквы, цифры и дефис",
    ),
  buildCommand: z.string().default("npm run build"),
  buildDir: z.string().default("dist"),
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
