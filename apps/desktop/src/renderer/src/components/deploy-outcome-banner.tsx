import { ExternalLink } from "lucide-react";
import { useI18n } from "../i18n";
import type { DeployOutcome } from "../lib/deploy-outcome";

/** The result line of a successful run on the "Deploy" tab: a confirmed
 *  link, the unreachable/plain-http notes or the address-less "done" line;
 *  kind "none" renders nothing */
export function DeployOutcomeBanner({ outcome }: { outcome: DeployOutcome }) {
  const { t } = useI18n();

  if (outcome.kind === "link") {
    return (
      <button
        onClick={() => window.plantar.openExternal(outcome.url)}
        className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-moss outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
      >
        {outcome.rolledBack
          ? t("deploy.rolledBackAt", { url: outcome.url })
          : t("deploy.deployedAt", { url: outcome.url })}
        <ExternalLink className="size-3.5" />
      </button>
    );
  }

  if (outcome.kind === "unreachable") {
    return (
      <p className="self-start text-sm font-semibold text-ink-soft">
        {outcome.rolledBack
          ? t("deploy.rolledBackNoResponse", { url: outcome.url })
          : t("deploy.deployedNoResponse", { url: outcome.url })}
      </p>
    );
  }

  if (outcome.kind === "plainHttp") {
    return (
      <div className="flex flex-col items-start gap-1 self-start">
        <p className="text-sm font-semibold text-ink-soft">
          {outcome.rolledBack
            ? t("deploy.rolledBackPlainHttp", {
                url: outcome.url,
                plainUrl: outcome.plainUrl,
              })
            : t("deploy.deployedPlainHttp", {
                url: outcome.url,
                plainUrl: outcome.plainUrl,
              })}
        </p>
        {/* The text asks the user to open the plain address, so it has to be
            openable from here — neutral styling, not the confirmed link */}
        <button
          onClick={() => window.plantar.openExternal(outcome.plainUrl)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft outline-none hover:underline focus-visible:ring-2 focus-visible:ring-moss/50"
        >
          {t("deploy.openPlainUrl", { url: outcome.plainUrl })}
          <ExternalLink className="size-3.5" />
        </button>
      </div>
    );
  }

  if (outcome.kind === "done") {
    return (
      <p className="self-start text-sm font-semibold text-moss">
        {outcome.rolledBack
          ? t("deploy.rolledBackDone")
          : outcome.isBot
            ? t("deploy.botDeployed")
            : t("deploy.deployedDone")}
      </p>
    );
  }

  return null;
}
