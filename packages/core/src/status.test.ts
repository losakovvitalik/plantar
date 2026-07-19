import { describe, expect, it } from "vitest";

import { parseSiteChecks, siteResponds } from "./status";

describe("siteResponds", () => {
  it("успех, редирект и коды авторизации — сайт отвечает", () => {
    expect(siteResponds("200")).toBe(true);
    expect(siteResponds("301")).toBe(true);
    expect(siteResponds("401")).toBe(true);
    expect(siteResponds("404")).toBe(true);
  });

  it("ошибки прокси и отсутствие ответа — сайт не отвечает", () => {
    expect(siteResponds("502")).toBe(false);
    expect(siteResponds("503")).toBe(false);
    expect(siteResponds("504")).toBe(false);
    expect(siteResponds("000")).toBe(false);
    expect(siteResponds("")).toBe(false);
  });
});

describe("parseSiteChecks", () => {
  it("сопоставляет ответы по номеру, порядок строк не важен", () => {
    expect(parseSiteChecks("1 502\n0 200\n2 301", 3)).toEqual([true, false, true]);
  });

  it("пропавшая или пустая строка — сайт не отвечает", () => {
    expect(parseSiteChecks("0 200", 2)).toEqual([true, false]);
    expect(parseSiteChecks("0 \n1 200", 2)).toEqual([false, true]);
  });
});
