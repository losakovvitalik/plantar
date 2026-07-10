import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

/** Лениво подгружает и показывает лог деплоя из файла */
export function DeployLogView({ logFile }: { logFile: string }) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await window.plantar.readDeployLog(logFile);
      if (result.ok) setContent(result.data);
      else setError(result.error);
    })();
  }, [logFile]);

  if (error) {
    return (
      <p className="border-t border-line px-4 py-3 text-[12.5px] text-clay">
        {t("history.loadLogError", { error })}
      </p>
    );
  }
  return (
    <pre className="thin-scroll max-h-72 overflow-y-auto rounded-b-xl bg-soil p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-sprout">
      {content ?? t("history.readingLog")}
    </pre>
  );
}
