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
      deployOutcome(run({ url: "https://new.example.com/", urlReachable: false })),
    ).toEqual({
      kind: "unreachable",
      url: "https://new.example.com/",
      rolledBack: false,
    });
  });

  it("адрес ответил: ссылка", () => {
    expect(
      deployOutcome(run({ url: "https://site.example/", urlReachable: true })),
    ).toEqual({ kind: "link", url: "https://site.example/", rolledBack: false });
  });

  it("проверки не было (старая запись истории): ссылка как раньше", () => {
    expect(deployOutcome(run({ url: "https://site.example/" }))).toEqual({
      kind: "link",
      url: "https://site.example/",
      rolledBack: false,
    });
  });

  it("возврат версии по неотвечающему адресу тоже без ссылки", () => {
    expect(
      deployOutcome(
        run({ kind: "rollback", url: "https://site.example/", urlReachable: false }),
      ),
    ).toEqual({
      kind: "unreachable",
      url: "https://site.example/",
      rolledBack: true,
    });
  });

  it("адреса нет (бот): сообщение без ссылки", () => {
    expect(deployOutcome(run())).toEqual({ kind: "done", rolledBack: false });
  });

  it("прогон не завершился успехом: показывать нечего", () => {
    expect(deployOutcome(null)).toEqual({ kind: "none" });
    expect(deployOutcome(run({ status: "running" }))).toEqual({ kind: "none" });
    expect(
      deployOutcome(run({ status: "error", url: "https://site.example/" })),
    ).toEqual({ kind: "none" });
  });
});
