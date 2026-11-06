import type { SectionDefinition } from "../types";
import { formatMinutes, isValidHHmm, parseHHmm } from "../time";

/**
 * Converts LLR's `sectionDefinitions` ([{ time: "0400", label: "朝" }, …]) into
 * this plugin's sections. Pure; invalid or empty entries are skipped (counted).
 */

function parseLlrTime(v: unknown): number | null {
  let h: number;
  let m: number;
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) return null;
    h = Math.floor(v / 100);
    m = v % 100;
  } else if (typeof v === "string") {
    const s = v.trim();
    const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
    const digits = /^(\d{3,4})$/.exec(s);
    if (colon) {
      h = Number(colon[1]);
      m = Number(colon[2]);
    } else if (digits) {
      const n = Number(digits[1]);
      h = Math.floor(n / 100);
      m = n % 100;
    } else {
      return null;
    }
  } else {
    return null;
  }
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

export function convertLlrSections(raw: unknown): { sections: SectionDefinition[]; skipped: number } {
  const sections: SectionDefinition[] = [];
  if (!Array.isArray(raw)) return { sections, skipped: 0 };
  let skipped = 0;
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null) {
      skipped++;
      continue;
    }
    const rec = item as Record<string, unknown>;
    const minutes = parseLlrTime(rec.time);
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    if (minutes === null || label === "") {
      skipped++;
      continue;
    }
    sections.push({ start: formatMinutes(minutes), heading: label });
  }
  return { sections, skipped };
}

/** Earliest section start when it is before the day boundary (a hint only), else null. */
export function sectionBeforeBoundary(sections: SectionDefinition[], dayBoundary: string): string | null {
  if (!isValidHHmm(dayBoundary)) return null;
  const boundary = parseHHmm(dayBoundary);
  let earliest: number | null = null;
  for (const s of sections) {
    if (!isValidHHmm(s.start)) continue;
    const m = parseHHmm(s.start);
    if (earliest === null || m < earliest) earliest = m;
  }
  return earliest !== null && earliest < boundary ? formatMinutes(earliest) : null;
}
