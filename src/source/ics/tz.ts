import ICAL from "ical.js";

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Returns a formatter for an IANA zone, or null when the runtime does not know it. */
function formatterFor(tzid: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(tzid);
  if (cached) return cached;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tzid, fmt);
    return fmt;
  } catch {
    return null;
  }
}

/** Offset (ms) of `tzid` from UTC at the absolute instant `utcMs`. */
export function intlOffsetMs(fmt: Intl.DateTimeFormat, utcMs: number): number {
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const hour = parts.hour === 24 ? 0 : (parts.hour ?? 0);
  const wall = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    hour,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  // Drop sub-second part of the probe instant so the difference is exact.
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Timezone backed by the runtime's Intl database. Used for TZIDs that have no
 * VTIMEZONE in the file but are valid IANA names (Google emits these).
 */
class IntlTimezone extends ICAL.Timezone {
  private readonly fmt: Intl.DateTimeFormat;

  constructor(tzid: string, fmt: Intl.DateTimeFormat) {
    super({ tzid });
    this.fmt = fmt;
  }

  /** `tt` is a wall-clock time in this zone; returns its UTC offset in seconds. */
  override utcOffset(tt: Time): number {
    const guess = Date.UTC(tt.year, tt.month - 1, tt.day, tt.hour, tt.minute, tt.second);
    const off1 = intlOffsetMs(this.fmt, guess);
    const off2 = intlOffsetMs(this.fmt, guess - off1);
    return off2 / 1000;
  }
}

function collectTzids(comp: Component, out: Set<string>): void {
  for (const prop of comp.getAllProperties()) {
    const tzid = prop.getParameter("tzid");
    if (typeof tzid === "string" && tzid) out.add(tzid);
  }
  for (const sub of comp.getAllSubcomponents()) {
    if (sub.name !== "vtimezone") collectTzids(sub, out);
  }
}

/**
 * Makes every TZID referenced in `root` resolvable. VTIMEZONEs in the file are
 * resolved by ical.js itself (per component tree); TZIDs without one are
 * registered globally as Intl-backed zones when they are IANA names. Unknown
 * names stay floating (device local time).
 *
 * Must run before any date property value is hydrated, because ical.js binds
 * the zone when the value is first decoded.
 */
export function ensureTimezones(root: Component): void {
  const defined = new Set<string>();
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    const id = vtz.getFirstProperty("tzid")?.getFirstValue();
    if (typeof id === "string") defined.add(id);
  }
  const used = new Set<string>();
  collectTzids(root, used);
  for (const tzid of used) {
    if (defined.has(tzid) || ICAL.TimezoneService.has(tzid)) continue;
    const fmt = formatterFor(tzid);
    if (fmt) ICAL.TimezoneService.register(new IntlTimezone(tzid, fmt), tzid);
  }
}

/** Absolute instant of an ical.js time. Dates → local midnight; floating → device local. */
export function toAbsolute(t: Time): Date {
  if (t.isDate) return new Date(t.year, t.month - 1, t.day);
  if (t.zone === ICAL.Timezone.localTimezone) {
    return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  }
  return new Date(t.toUnixTime() * 1000);
}
