import { describe, expect, it } from "vitest";
import { deployOutcome } from "./deploy-outcome";

type Run = NonNullable<Parameters<typeof deployOutcome>[0]>;

const run = (over: Partial<Run> = {}): Run => ({
  status: "success",
  kind: "deploy",
  ...over,
});

describe("deployOutcome", () => {
  it("адрес не ответил: ссылки нет — деплой не выдаётся за работающий сайт", () => {
    expect(
      deployOutcome(
        run({ url: "https://new.example.com/", urlCheck: "no-answer" }),
        false,
      ),
    ).toEqual({
      kind: "unreachable",
      url: "https://new.example.com/",
      rolledBack: false,
    });
  });

  it("адрес ответил: ссылка", () => {
    expect(
      deployOutcome(run({ url: "https://site.example/", urlCheck: "answered" }), false),
    ).toEqual({ kind: "link", url: "https://site.example/", rolledBack: false });
  });

  it("ответил только обычный http: ссылки нет, и настроенный адрес не подменяется", () => {
    expect(
      deployOutcome(
        run({ url: "https://new.example.com/", urlCheck: "plain-http" }),
        false,
      ),
    ).toEqual({
      kind: "plainHttp",
      url: "https://new.example.com/",
      plainUrl: "http://new.example.com/",
      rolledBack: false,
    });
  });

  // The status travels through storage and IPC, so the https prefix the plain
  // address is derived from cannot be taken on trust
  it("исход plain-http на адресе без https: адрес не режется, исход — «не ответило»", () => {
    expect(
      deployOutcome(run({ url: "http://1.2.3.4/", urlCheck: "plain-http" }), false),
    ).toEqual({
      kind: "unreachable",
      url: "http://1.2.3.4/",
      rolledBack: false,
    });
  });

  it("проверки не было (старая запись истории): ссылка как раньше", () => {
    expect(deployOutcome(run({ url: "https://site.example/" }), false)).toEqual({
      kind: "link",
      url: "https://site.example/",
      rolledBack: false,
    });
  });

  it("возврат версии по неотвечающему адресу тоже без ссылки", () => {
    expect(
      deployOutcome(
        run({ kind: "rollback", url: "https://site.example/", urlCheck: "no-answer" }),
        false,
      ),
    ).toEqual({
      kind: "unreachable",
      url: "https://site.example/",
      rolledBack: true,
    });
  });

  it("адреса нет, это бот: сообщение про бота", () => {
    expect(deployOutcome(run(), true)).toEqual({
      kind: "done",
      rolledBack: false,
      isBot: true,
    });
  });

  it("адреса нет у веб-приложения: сообщение не про бота", () => {
    expect(deployOutcome(run(), false)).toEqual({
      kind: "done",
      rolledBack: false,
      isBot: false,
    });
  });

  // The "History" tab calls the same function, so its "Open site" button is
  // missing for exactly the runs the "Deploy" tab does not link either
  it("запись истории (kind может отсутствовать): решение то же", () => {
    const record = { status: "success" as const, url: "https://site.example/" };
    expect(deployOutcome(record)).toEqual({
      kind: "link",
      url: "https://site.example/",
      rolledBack: false,
    });
    expect(deployOutcome({ ...record, urlCheck: "no-answer" })).toEqual({
      kind: "unreachable",
      url: "https://site.example/",
      rolledBack: false,
    });
    expect(deployOutcome({ ...record, urlCheck: "plain-http" }).kind).toBe("plainHttp");
  });

  it("прогон не завершился успехом: показывать нечего", () => {
    expect(deployOutcome(null, false)).toEqual({ kind: "none" });
    expect(deployOutcome(run({ status: "running" }), false)).toEqual({ kind: "none" });
    expect(
      deployOutcome(run({ status: "error", url: "https://site.example/" }), false),
    ).toEqual({ kind: "none" });
  });
});
