import type { DateWindow, EventKey, HHmm, LocalDate } from "./types";

/** Shared time helpers (local time zone). FROZEN for workers. */

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" → minutes since midnight. Throws on invalid input. */
export function parseHHmm(value: HHmm): number {
  const m = HHMM_RE.exec(value.trim());
  if (!m) throw new Error(`Invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidHHmm(value: string): boolean {
  return HHMM_RE.test(value.trim());
}

/** minutes since midnight → "HH:mm" (wraps modulo 24h). */
export function formatMinutes(minutes: number): HHmm {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Local wall-clock "HH:mm" of an instant. */
export function formatLocalTime(d: Date): HHmm {
  return formatMinutes(d.getHours() * 60 + d.getMinutes());
}

export function formatLocalDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → local midnight Date. */
export function parseLocalDate(date: LocalDate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Local-time instant for date + minutes since midnight (DST-safe via Date ctor). */
function atLocal(date: LocalDate, minutes: number): Date {
  const base = parseLocalDate(date);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, minutes);
}

/** Logical (daily-note) date of an instant: before the boundary → previous day. */
export function logicalDate(now: Date, boundary: HHmm): LocalDate {
  const b = parseHHmm(boundary);
  const mins = now.getHours() * 60 + now.getMinutes();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (mins < b) d.setDate(d.getDate() - 1);
  return formatLocalDate(d);
}

/** Window of instants belonging to a logical date: [date@boundary, date+1@boundary). */
export function windowForDate(date: LocalDate, boundary: HHmm): DateWindow {
  const b = parseHHmm(boundary);
  return { start: atLocal(date, b), end: atLocal(date, 1440 + b) };
}

/** Minutes after the boundary for a wall-clock time (0..1439). */
export function minutesFromBoundary(time: HHmm | Date, boundary: HHmm): number {
  const t = typeof time === "string" ? parseHHmm(time) : time.getHours() * 60 + time.getMinutes();
  return (((t - parseHHmm(boundary)) % 1440) + 1440) % 1440;
}

export function eventKey(uid: string, start: Date): EventKey {
  return { uid, startIso: start.toISOString() };
}

export function keyString(k: EventKey): string {
  return `${k.uid}\u0000${k.startIso}`;
}
