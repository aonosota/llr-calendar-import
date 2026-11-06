import { getLanguage } from "obsidian";
import { resolveLang, translator } from "./dict";
import type { Lang, Translate } from "./dict";

export type { Lang, MessageKey, Translate } from "./dict";
export { resolveLang, translator } from "./dict";

/** App language from Obsidian (getLanguage(), Obsidian >= 1.8.7); falls back to en. */
export function detectLang(): Lang {
  try {
    return resolveLang(getLanguage());
  } catch {
    return "en";
  }
}

export function createTranslator(): { lang: Lang; t: Translate } {
  const lang = detectLang();
  return { lang, t: translator(lang) };
}
