import type { SiteCheckStatus } from "@plantar/core";
import { t } from "./i18n";

/**
 * Picks the system-notification text for a finished run. A run whose
 * post-deploy check got no answer (or only an answer on plain http) did
 * succeed as a deploy, but the notification must not round it up to
 * "the site is live" — the user who closed the window would otherwise
 * learn about the downtime from their visitors.
 */
export function deployNotificationText(
  name: string,
  success: boolean,
  urlCheck?: SiteCheckStatus,
): { title: string; body: string } {
  if (!success) {
    return { title: t("notifyErrorTitle"), body: t("notifyErrorBody", { name }) };
  }
  if (urlCheck === "no-answer") {
    return { title: t("notifyNoAnswerTitle"), body: t("notifyNoAnswerBody", { name }) };
  }
  if (urlCheck === "plain-http") {
    return { title: t("notifyPlainHttpTitle"), body: t("notifyPlainHttpBody", { name }) };
  }
  // "answered", or a run with no address to check at all
  return { title: t("notifySuccessTitle"), body: t("notifySuccessBody", { name }) };
}
