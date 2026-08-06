// Single source of truth for the validation rules also enforced by the
// zod schema in index.ts. Kept free of zod and node imports so the
// renderer can consume it without pulling those into the bundle.

export const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export const PORT_MIN = 1;
export const PORT_MAX = 65535;

/** True when the name satisfies the project name rule from the config schema. */
export function validateProjectName(name: string): boolean {
  return PROJECT_NAME_REGEX.test(name);
}

/**
 * Validates a port as typed into a form field.
 * An empty (trimmed) value is allowed — it means "assign automatically".
 */
export function validatePort(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true;
  if (!/^\d+$/.test(trimmed)) return false;
  const port = Number(trimmed);
  return port >= PORT_MIN && port <= PORT_MAX;
}

/**
 * Parses a port as typed into a form field.
 * An empty (trimmed) value returns undefined — it means "assign automatically".
 * Assumes the input already passed validatePort.
 */
export function parsePort(input: string): number | undefined {
  const trimmed = input.trim();
  return trimmed ? Number(trimmed) : undefined;
}
