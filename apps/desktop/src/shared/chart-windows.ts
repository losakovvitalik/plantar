/**
 * Chart windows in seconds — the cross-process protocol between the renderer
 * (window toggle) and the main process (clamping the untrusted request).
 * Both sides import from here so the values can never drift apart.
 */
export const HOUR = 3600;
export const DAY = 86400;
export type ChartWindow = typeof HOUR | typeof DAY;
