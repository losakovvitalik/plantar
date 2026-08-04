import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { shellQuote } from "./index";

// [case name, raw value, expected quoted form]
const CASES: Array<[string, string, string]> = [
  ["empty string", "", "''"],
  ["spaces", "hello world", "'hello world'"],
  ["single quote", "o'brien", "'o'\\''brien'"],
  ["dollar sign", "$HOME", "'$HOME'"],
  ["backticks", "`id`", "'`id`'"],
  ["newline", "line1\nline2", "'line1\nline2'"],
];

/** Runs the quoted value through a real shell and returns what the command saw */
function echoThroughShell(value: string): string {
  return execFileSync("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`], {
    encoding: "utf8",
  });
}

describe("shellQuote", () => {
  it.each(CASES)("%s stays a literal", (_name, input, expected) => {
    expect(shellQuote(input)).toBe(expected);
  });

  it.each(CASES)("%s survives a real shell round-trip unchanged", (_name, input) => {
    expect(echoThroughShell(input)).toBe(input);
  });

  it("an injection attempt arrives as data, not as a command", () => {
    const payload = "'; echo pwned; '";
    expect(echoThroughShell(payload)).toBe(payload);
  });
});
