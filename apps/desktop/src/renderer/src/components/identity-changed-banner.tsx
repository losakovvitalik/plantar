import { useI18n } from "../i18n";
import { Button } from "./ui/button";

interface Props {
  /** Opens the confirmation that records the server's new key */
  onTrustHostKey: () => void;
}

/**
 * The server answers with a host key other than the one on record: every
 * connection to it is refused until that is sorted out, so the reason gets a
 * place of its own instead of a failed request. Shown in the server header and
 * above the project tabs alike — deploys and refreshes from either fail the
 * same way, and the human reason has to be visible in both.
 */
export function IdentityChangedBanner({ onTrustHostKey }: Props) {
  const { t } = useI18n();
  return (
    <div className="mt-2 rounded-xl bg-amber-bg px-4 py-3 text-[13px] leading-relaxed text-ink">
      <p>
        <span className="font-semibold">{t("app.identityChanged")}</span>{" "}
        {t("app.identityChangedNote")}
      </p>
      {/* Only opens the confirmation: recording another server's key is what an
          attacker would want from this screen, so it never happens on one click */}
      <Button variant="outline" size="sm" className="mt-2.5" onClick={onTrustHostKey}>
        {t("trustHostKey.action")}
      </Button>
    </div>
  );
}
