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
      deployOutcome(run({ url: "https://new.example.com/", urlReachable: false }), false),
    ).toEqual({
      kind: "unreachable",
      url: "https://new.example.com/",
      rolledBack: false,
    });
  });

  it("адрес ответил: ссылка", () => {
    expect(
      deployOutcome(run({ url: "https://site.example/", urlReachable: true }), false),
    ).toEqual({ kind: "link", url: "https://site.example/", rolledBack: false });
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
        run({ kind: "rollback", url: "https://site.example/", urlReachable: false }),
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

  it("прогон не завершился успехом: показывать нечего", () => {
    expect(deployOutcome(null, false)).toEqual({ kind: "none" });
    expect(deployOutcome(run({ status: "running" }), false)).toEqual({ kind: "none" });
    expect(
      deployOutcome(run({ status: "error", url: "https://site.example/" }), false),
    ).toEqual({ kind: "none" });
  });
});
