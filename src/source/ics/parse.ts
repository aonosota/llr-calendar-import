import ICAL from "ical.js";
import type { DateWindow, EventStatus, FetchContext, NormalizedEvent, Partstat } from "../../types";
import { SourceError } from "../../types";
import { ensureTimezones, toAbsolute } from "./tz";

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type Duration = InstanceType<typeof ICAL.Duration>;

/** Upper bound of occurrences examined per recurring series (guards infinite rules). */
export const MAX_OCCURRENCES_PER_SERIES = 100_000;

const PARTSTATS: ReadonlySet<string> = new Set<Partstat>([
  "accepted",
  "declined",
  "tentative",
  "needs-action",
  "delegated",
]);

export interface ParseOptions {
  sourceLabel?: string;
}

/**
 * Whether an instance belongs to the window.
 *
 * Timed events: start ∈ [window.start, window.end).
 *
 * All-day events (start = local midnight of date D): D is shifted by the
 * window's local time-of-day offset, i.e. included iff D@offset ∈ window where
 * offset = window.start − localMidnight(window.start). With a 04:00 day
 * boundary, windowForDate("2026-11-04","04:00") therefore includes the 11/04
 * all-day event and excludes the 11/05 one. For a midnight window this equals
 * the plain start-in-window rule. Only the start date is considered for
 * multi-day all-day events. (Approved by the coordinator.)
 */
export function isInWindow(start: Date, allDay: boolean, window: DateWindow): boolean {
  let probe = start;
  if (allDay) {
    const ws = window.start;
    probe = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      ws.getHours(),
      ws.getMinutes(),
      ws.getSeconds(),
      ws.getMilliseconds(),
    );
  }
  const t = probe.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/** 32-bit FNV-1a, hex. Stable across platforms. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function textProp(comp: Component, name: string): string {
  const v = comp.getFirstPropertyValue(name);
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function statusOf(comp: Component): EventStatus {
  const s = textProp(comp, "status").trim().toUpperCase();
  if (s === "CANCELLED") return "cancelled";
  if (s === "TENTATIVE") return "tentative";
  return "confirmed";
}

function partstatOf(comp: Component, myEmail: string | undefined): Partstat | null {
  const target = myEmail?.trim().toLowerCase();
  if (!target) return null;
  for (const prop of comp.getAllProperties("attendee")) {
    const raw = String(prop.getFirstValue() ?? "").trim().toLowerCase();
    const addr = raw.startsWith("mailto:") ? raw.slice("mailto:".length) : raw;
    if (addr !== target) continue;
    const param: unknown = prop.getParameter("partstat");
    const value: unknown = Array.isArray(param) ? (param as unknown[])[0] : param;
    // RFC 5545: PARTSTAT defaults to NEEDS-ACTION.
    const ps = typeof value === "string" ? value.toLowerCase() : "needs-action";
    return PARTSTATS.has(ps) ? (ps as Partstat) : null;
  }
  return null;
}

function timeProp(comp: Component, name: string): Time | null {
  const v = comp.getFirstPropertyValue(name);
  return v instanceof ICAL.Time ? v : null;
}

function hasEnd(comp: Component): boolean {
  return comp.hasProperty("dtend") || comp.hasProperty("duration");
}

function endFrom(start: Time, duration: Duration | null): Date | null {
  if (!duration) return null;
  // Add on the wall clock of the start's zone, then convert (DST-correct).
  const end = start.clone();
  end.addDuration(duration);
  return toAbsolute(end);
}

function uidOf(comp: Component): string {
  const uid = textProp(comp, "uid").trim();
  if (uid) return uid;
  const dtstart = comp.getFirstProperty("dtstart");
  const seed = `${dtstart ? dtstart.toICALString() : ""}\u0000${textProp(comp, "summary")}`;
  return `synth-${fnv1a(seed)}`;
}

interface Group {
  masters: Component[];
  /** RECURRENCE-ID absolute ms → override component. */
  overrides: Map<number, Component>;
}

/**
 * Parses ICS text and returns every event instance whose start lies in
 * ctx.window (see isInWindow for all-day handling). Recurrences are expanded;
 * nothing is filtered by status, all-day or partstat.
 *
 * Throws SourceError("parse") when the file itself is malformed. Individual
 * broken VEVENTs (no DTSTART, invalid RRULE, ...) are skipped.
 */
export function parseIcsEvents(
  icsText: string,
  ctx: FetchContext,
  opts: ParseOptions = {},
): NormalizedEvent[] {
  const label = opts.sourceLabel;
  const fail = (): never => {
    throw new SourceError(
      `Could not parse calendar data${label ? ` for "${label}"` : ""}`,
      "parse",
      label,
    );
  };

  if (!icsText || !icsText.trim()) fail();
  let root: Component;
  try {
    const jcal = ICAL.parse(icsText) as unknown[];
    root = new ICAL.Component(jcal);
  } catch {
    return fail();
  }
  if (root.name !== "vcalendar") fail();
  ensureTimezones(root);

  // Group components by UID, preserving file order of first appearance.
  const groups = new Map<string, Group>();
  for (const comp of root.getAllSubcomponents("vevent")) {
    try {
      if (!comp.hasProperty("dtstart") && !comp.hasProperty("recurrence-id")) continue;
      const uid = uidOf(comp);
      let g = groups.get(uid);
      if (!g) {
        g = { masters: [], overrides: new Map() };
        groups.set(uid, g);
      }
      const rid = timeProp(comp, "recurrence-id");
      if (rid) g.overrides.set(toAbsolute(rid).getTime(), comp);
      else g.masters.push(comp);
    } catch {
      // Broken component: skip it.
    }
  }

  const out: NormalizedEvent[] = [];
  const emit = (comp: Component, uid: string, start: Time, end: Date | null): void => {
    const startDate = toAbsolute(start);
    if (!isInWindow(startDate, start.isDate, ctx.window)) return;
    const ev: NormalizedEvent = {
      uid,
      start: startDate,
      end,
      allDay: start.isDate,
      title: textProp(comp, "summary"),
      status: statusOf(comp),
      myPartstat: partstatOf(comp, ctx.myEmail),
    };
    if (label !== undefined) ev.sourceLabel = label;
    out.push(ev);
  };

  const windowEnd = ctx.window.end.getTime();
  for (const [uid, g] of groups) {
    let masterDuration: Duration | null = null;
    for (const comp of g.masters) {
      try {
        const event = new ICAL.Event(comp);
        const dtstart = event.startDate;
        if (!dtstart) continue;
        const duration = hasEnd(comp) ? event.duration : null;
        masterDuration ??= duration;
        if (!event.isRecurring()) {
          if (!g.overrides.has(toAbsolute(dtstart).getTime())) {
            emit(comp, uid, dtstart, endFrom(dtstart, duration));
          }
          continue;
        }
        const it = event.iterator();
        for (let n = 0; n < MAX_OCCURRENCES_PER_SERIES; n++) {
          const occ = it.next();
          if (!occ) break;
          const ms = toAbsolute(occ).getTime();
          // All-day probes are D@offset >= D midnight, so this cut-off is safe for both kinds.
          if (ms >= windowEnd) break;
          if (g.overrides.has(ms)) continue; // replaced by its RECURRENCE-ID override
          emit(comp, uid, occ, endFrom(occ, duration));
        }
      } catch {
        // Broken master (e.g. invalid RRULE): skip it.
      }
    }

    // Overrides are emitted at their own (possibly moved) start, so an
    // instance moved into the window appears and one moved out disappears.
    for (const comp of g.overrides.values()) {
      try {
        const start = timeProp(comp, "dtstart") ?? timeProp(comp, "recurrence-id");
        if (!start) continue;
        const end = hasEnd(comp)
          ? toAbsolute(new ICAL.Event(comp).endDate)
          : endFrom(start, masterDuration); // sparse override: inherit master duration
        emit(comp, uid, start, end);
      } catch {
        // Broken override: skip it.
      }
    }
  }

  // Stable sort keeps file order for identical starts.
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
