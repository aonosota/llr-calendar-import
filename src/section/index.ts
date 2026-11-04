import type { HeadingMatchMode, HHmm, SectionDefinition } from "../types";
import { formatMinutes, isValidHHmm, minutesFromBoundary, parseHHmm } from "../time";

/**
 * Section definitions, section assignment and heading lookup.
 * Pure: no `obsidian` import, no Node APIs.
 */

export interface HeadingInfo {
  /** 0-based line index. */
  line: number;
  /** ATX level 1..6. */
  level: number;
  /** Heading text without the leading/closing `#` sequences, trimmed. */
  text: string;
}

export interface SectionLocation {
  /** 0-based line index of the heading. */
  headingLine: number;
  /** First body line (headingLine + 1). */
  bodyStart: number;
  /** Exclusive end of the body: next heading of same or higher level, or line count. */
  bodyEnd: number;
}

/**
 * Validate, clean and sort section definitions.
 * - Entries with an empty (whitespace-only) heading are dropped.
 * - `start` must be HH:mm (H:mm accepted); it is normalized to zero-padded HH:mm.
 * - Sorted by minutes from the day boundary.
 * - Duplicate starts throw.
 */
export function normalizeSections(defs: SectionDefinition[], boundary: HHmm): SectionDefinition[] {
  if (!isValidHHmm(boundary)) throw new Error(`Invalid day boundary time: "${boundary}"`);
  const out: SectionDefinition[] = [];
  const seen = new Map<string, string>();
  for (const def of defs) {
    const heading = def.heading.trim();
    if (heading === "") continue;
    if (!isValidHHmm(def.start)) {
      throw new Error(`Invalid section start time "${def.start}" for section "${heading}" (expected HH:mm)`);
    }
    const start = formatMinutes(parseHHmm(def.start));
    const prev = seen.get(start);
    if (prev !== undefined) {
      throw new Error(`Duplicate section start time ${start}: "${prev}" and "${heading}"`);
    }
    seen.set(start, heading);
    out.push({ start, heading });
  }
  return out.sort(
    (a, b) => minutesFromBoundary(a.start, boundary) - minutesFromBoundary(b.start, boundary),
  );
}

/**
 * Index of the latest section whose start (minutes from boundary) <= t.
 * Before the first section → 0 (decision 0.1-3). Empty list → -1.
 * `sorted` must come from normalizeSections with the same boundary.
 */
export function assignSection(
  minutesFromBoundaryValue: number,
  sorted: SectionDefinition[],
  boundary: HHmm,
): number {
  if (sorted.length === 0) return -1;
  let idx = 0;
  sorted.forEach((s, i) => {
    if (minutesFromBoundary(s.start, boundary) <= minutesFromBoundaryValue) idx = i;
  });
  return idx;
}

/** Split note text into lines (handles \n and \r\n). */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function headingTextOf(rest: string): string {
  let t = rest.trim();
  // Optional closing sequence: must be preceded by whitespace (or be the whole text).
  if (/^#+$/.test(t)) return "";
  t = t.replace(/[ \t]+#+$/, "");
  return t.trim();
}

/** Index after YAML frontmatter (0 when none). Unclosed frontmatter is not frontmatter. */
function frontmatterEnd(lines: string[]): number {
  if ((lines[0] ?? "").trimEnd() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    const l = (lines[i] ?? "").trimEnd();
    if (l === "---" || l === "...") return i + 1;
  }
  return 0;
}

/** ATX headings of a line array, skipping YAML frontmatter and fenced code blocks. */
export function scanHeadings(lines: string[]): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  let fence: { char: string; len: number } | null = null;
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i] ?? "";
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1] !== undefined && f[1][0] === fence.char && f[1].length >= fence.len && (f[2] ?? "").trim() === "") {
        fence = null;
      }
      continue;
    }
    if (f && f[1] !== undefined) {
      const char = f[1][0] ?? "`";
      // Backtick fences may not have backticks in the info string.
      if (!(char === "`" && (f[2] ?? "").includes("`"))) {
        fence = { char, len: f[1].length };
        continue;
      }
    }
    const m = ATX_RE.exec(line);
    if (m && m[1] !== undefined) {
      out.push({ line: i, level: m[1].length, text: headingTextOf(m[2] ?? "") });
    }
  }
  return out;
}

/** ATX headings (# .. ######) of a note, ignoring frontmatter and fenced code. */
export function findHeadings(noteText: string): HeadingInfo[] {
  return scanHeadings(splitLines(noteText));
}

function foldForMatch(s: string): string {
  return s.normalize("NFC").trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * exact: trimmed equality; partial: heading text includes label.
 * NFC-normalized, ASCII case-insensitive. An empty label never matches.
 */
export function matchHeading(label: string, headingText: string, mode: HeadingMatchMode): boolean {
  const l = foldForMatch(label);
  const h = foldForMatch(headingText);
  if (l === "") return false;
  return mode === "partial" ? h.includes(l) : h === l;
}

/** Body end (exclusive) of the heading at `headings[idx]`. */
export function sectionEnd(headings: HeadingInfo[], idx: number, lineCount: number): number {
  const h = headings[idx];
  if (!h) return lineCount;
  for (let j = idx + 1; j < headings.length; j++) {
    const next = headings[j];
    if (next && next.level <= h.level) return next.line;
  }
  return lineCount;
}

/** locateSection on a line array. */
export function locateSectionInLines(
  lines: string[],
  label: string,
  mode: HeadingMatchMode,
): SectionLocation | null {
  const headings = scanHeadings(lines);
  const idx = headings.findIndex((h) => matchHeading(label, h.text, mode));
  const h = headings[idx];
  if (!h) return null;
  return { headingLine: h.line, bodyStart: h.line + 1, bodyEnd: sectionEnd(headings, idx, lines.length) };
}

/**
 * First heading matching `label` and its body range (0-based lines, bodyEnd exclusive),
 * or null when no heading matches.
 */
export function locateSection(
  noteText: string,
  label: string,
  mode: HeadingMatchMode,
): SectionLocation | null {
  return locateSectionInLines(splitLines(noteText), label, mode);
}
