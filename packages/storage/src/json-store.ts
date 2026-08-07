import {
  closeSync,
  copyFileSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

/** Keeps the unusable file as <file>.broken, the first occurrence only */
export function keepBrokenCopy(file: string): void {
  const backup = `${file}.broken`;
  try {
    if (!existsSync(backup)) copyFileSync(file, backup);
  } catch {
    // best effort — recovering the backup must not introduce a new crash
  }
}

/**
 * Reads a JSON store, or null when the file is missing or corrupted. The
 * corrupted file is kept as <file>.broken (first occurrence only) so data can
 * be recovered — hence the separate null: a caller that deletes files the store
 * points at must be able to tell a lost store from an empty one.
 */
export function readJsonOrNull<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.error(`plantar: corrupted JSON store ${file}, falling back to defaults`, err);
    keepBrokenCopy(file);
    return null;
  }
}

/**
 * Reads a JSON store, degrading to a fallback when the file is missing or
 * corrupted: a broken store must never crash startup.
 */
export function readJsonSafe<T>(file: string, fallback: T): T {
  return readJsonOrNull<T>(file) ?? fallback;
}

/**
 * Writes a JSON store atomically: temp file in the same directory + rename,
 * so a crash mid-write leaves either the old or the new content on disk.
 * The temp file is fsynced before the rename — otherwise the filesystem may
 * journal the rename ahead of the data blocks and power loss would still
 * leave a truncated target.
 * The optional mode sets the permissions the temp file is created with, and
 * the rename carries them onto the target — for stores holding a secret that
 * must not be readable by other local users.
 */
export function writeJsonAtomic(file: string, data: unknown, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w", mode);
    try {
      // open()'s mode applies only at creation: a stale temp file left by a
      // hard-killed pre-0600 write and reused after PID wraparound would keep
      // its loose permissions, and the rename would carry them onto the target
      if (mode !== undefined) fchmodSync(fd, mode);
      writeSync(fd, JSON.stringify(data, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function readJsonList<T>(file: string): T[] {
  const list = readJsonSafe<T[]>(path.join(dataDir(), file), []);
  // Valid JSON of the wrong shape (e.g. a hand-edited `null`) must not
  // push the crash into the caller's first .map
  return Array.isArray(list) ? list : [];
}

export function writeJsonList<T>(file: string, list: T[]): void {
  writeJsonAtomic(path.join(dataDir(), file), list);
}
