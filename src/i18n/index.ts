import { getLanguage } from "obsidian";
import { resolveLang, translator } from "./dict";
import type { Lang, Translate } from "./dict";

export type { Lang, MessageKey, Translate } from "./dict";
export { resolveLang, translator } from "./dict";

/** App language: getLanguage() (Obsidian >= 1.8.7) or localStorage "language"; default en. */
export function detectLang(): Lang {
  try {
    if (typeof getLanguage === "function") return resolveLang(getLanguage());
  } catch {
    // fall through
  }
  try {
    return resolveLang(window.localStorage.getItem("language"));
  } catch {
    return "en";
  }
}

export function createTranslator(): { lang: Lang; t: Translate } {
  const lang = detectLang();
  return { lang, t: translator(lang) };
}
