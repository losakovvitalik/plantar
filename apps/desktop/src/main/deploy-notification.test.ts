import { describe, expect, it } from "vitest";
import { deployNotificationText } from "./deploy-notification";
import { t } from "./i18n";

describe("deployNotificationText", () => {
  it("no-answer run gets its own warning text instead of the success one", () => {
    const text = deployNotificationText("app", true, "no-answer");

    expect(text).toEqual({
      title: t("notifyNoAnswerTitle"),
      body: t("notifyNoAnswerBody", { name: "app" }),
    });
    expect(text.title).not.toBe(t("notifySuccessTitle"));
    expect(text.body).not.toBe(t("notifySuccessBody", { name: "app" }));
  });

  it("plain-http run gets a text distinct from both success and no-answer", () => {
    const text = deployNotificationText("app", true, "plain-http");

    expect(text).toEqual({
      title: t("notifyPlainHttpTitle"),
      body: t("notifyPlainHttpBody", { name: "app" }),
    });
    expect(text.title).not.toBe(t("notifySuccessTitle"));
    expect(text.title).not.toBe(t("notifyNoAnswerTitle"));
  });

  it("answered run and a run without an address keep the plain success text", () => {
    const success = {
      title: t("notifySuccessTitle"),
      body: t("notifySuccessBody", { name: "app" }),
    };

    expect(deployNotificationText("app", true, "answered")).toEqual(success);
    expect(deployNotificationText("app", true, undefined)).toEqual(success);
  });

  it("failed run keeps the error text regardless of urlCheck", () => {
    expect(deployNotificationText("app", false)).toEqual({
      title: t("notifyErrorTitle"),
      body: t("notifyErrorBody", { name: "app" }),
    });
  });
});
