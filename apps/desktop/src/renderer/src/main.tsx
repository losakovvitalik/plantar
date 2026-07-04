import "@fontsource-variable/manrope";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import React from "react";
import ReactDOM from "react-dom/client";
import type { Language } from "@plantar/storage";
import App from "./app";
import { I18nProvider } from "./i18n";
import "./styles.css";

// Язык читается до первого рендера, чтобы интерфейс не мигал другим языком
async function bootstrap() {
  const settings = await window.plantar.getSettings();
  const fallback: Language = navigator.language.toLowerCase().startsWith("ru")
    ? "ru"
    : "en";
  const lang = settings.ok ? settings.data.language : fallback;

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider initialLang={lang}>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
