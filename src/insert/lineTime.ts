import type { HHmm } from "../types";
import { formatMinutes, isValidHHmm, parseHHmm } from "../time";

/**
 * Minimal local recognizer for LLR task lines. Isolated here so it can be swapped
 * for the canonical parser in src/llr later.
 */

const TASK_RE = /^\s*[-*] \[.\] (.*)$/;
const TIMED_RE = /^(\d?\d:\d\d) (.*)$/;

export interface TaskLineParts {
  /** Zero-padded leading time, or null when the task has no leading time. */
  time: HHmm | null;
  /** Text after the checkbox (and after the time when present). */
  text: string;
}

/** Parse a list task line ("- [?] ..." / "* [?] ..."). Non-task lines → null. */
export function readTaskLine(line: string): TaskLineParts | null {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const body = m[1] ?? "";
  const t = TIMED_RE.exec(body);
  if (t && t[1] !== undefined && isValidHHmm(t[1])) {
    return { time: formatMinutes(parseHHmm(t[1])), text: t[2] ?? "" };
  }
  return { time: null, text: body };
}

/** Leading "H?H:mm" of a task line (normalized to HH:mm), or null. */
export function readLeadingTime(line: string): HHmm | null {
  return readTaskLine(line)?.time ?? null;
}
