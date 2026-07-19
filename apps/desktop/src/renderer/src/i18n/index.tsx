import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Language } from "@plantar/storage";
import { type MessageKey, ru } from "./ru";
import { en } from "./en";

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { ru, en };

export type Translate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  lang: Language;
  /** Меняет язык всего UI сразу, без перезапуска; сохранение — забота настроек */
  setLang: (lang: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLang,
  children,
}: {
  initialLang: Language;
  children: ReactNode;
}) {
  const [lang, setLang] = useState(initialLang);

  const t = useCallback<Translate>(
    (key, params) => {
      const template = DICTIONARIES[lang][key];
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
