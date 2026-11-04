import type { Lang } from "../i18n/dict";
import { translator } from "../i18n/dict";
import type { ImportOutcome } from "./index";

/**
 * Builds the result notice (requirements 3.1). Pure.
 * Line 1: summary; following lines: one "fetch failed" line per failed source.
 * `fallbackLabel` is the bare fallback heading label (e.g. "Calendar"); it is
 * reported in its own clause instead of the per-heading list.
 */
export function buildNoticeMessage(outcome: ImportOutcome, lang: Lang, fallbackLabel: string): string {
  const t = translator(lang);
  const sep = lang === "ja" ? "、" : ", ";
  const s = outcome.summary;
  const lines: string[] = [];

  switch (outcome.status) {
    case "noSources":
      lines.push(t("notice.noSources"));
      break;
    case "allFailed":
      lines.push(t("notice.allFailed"));
      break;
    case "settingsError":
      lines.push(t("notice.settingsError", { message: outcome.errorMessage ?? "" }));
      break;
    case "ok": {
      let head: string;
      if (s.inserted > 0) {
        head = t("notice.inserted", { n: s.inserted });
        const parts = Object.entries(s.perHeading)
          .filter(([label]) => !(s.fallback > 0 && label === fallbackLabel))
          .map(([label, n]) => `${label} ${n}`);
        if (parts.length > 0) head += `${lang === "ja" ? "" : " "}(${parts.join(sep)})`;
      } else {
        head = t("notice.nothingNew");
      }
      const clauses = [head];
      if (s.duplicates > 0) clauses.push(t("notice.dup", { n: s.duplicates }));
      if (s.changed > 0) clauses.push(t("notice.changed", { n: s.changed }));
      if (s.fallback > 0) clauses.push(t("notice.fallback", { n: s.fallback, heading: fallbackLabel }));
      if (s.filtered > 0) clauses.push(t("notice.filtered", { n: s.filtered }));
      lines.push(clauses.join(sep));
      break;
    }
  }

  for (const name of s.failedSources) lines.push(t("notice.failed", { name }));
  return lines.join("\n");
}
