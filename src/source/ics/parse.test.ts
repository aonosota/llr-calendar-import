import { describe, expect, it } from "vitest";
import { SourceError } from "../../types";
import type { DateWindow, FetchContext } from "../../types";
import { windowForDate } from "../../time";
import { isInWindow, parseIcsEvents } from "./index";

/** Wraps body lines into a VCALENDAR with CRLF line endings. */
function cal(...blocks: string[]): string {
  const body = blocks.join("\n").trim().split("\n").map((l) => l.trim());
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...body, "END:VCALENDAR"].join(
    "\r\n",
  );
}

function vevent(...lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\n");
}

/** 11/04 logical day with a 04:00 boundary: [2026-11-03T19:00Z, 2026-11-04T19:00Z) in Asia/Tokyo. */
const DAY = windowForDate("2026-11-04", "04:00");
const ctx = (window: DateWindow = DAY, myEmail?: string): FetchContext => ({ window, myEmail });
/** TZ-independent wide window (absolute UTC instants). */
const WIDE: DateWindow = {
  start: new Date(Date.UTC(2026, 0, 1)),
  end: new Date(Date.UTC(2027, 0, 1)),
};

const EASTERN_VTZ = `
BEGIN:VTIMEZONE
TZID:Custom/Eastern
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

describe("parseIcsEvents: time zones", () => {
  it("converts a UTC event (TZ-independent)", () => {
    const evs = parseIcsEvents(
      cal(vevent("UID:u1", "DTSTART:20261104T010000Z", "DTEND:20261104T020000Z", "SUMMARY:Standup")),
      ctx(WIDE),
    );
    expect(evs).toHaveLength(1);
    const e = evs[0]!;
    expect(e.start.getTime()).toBe(Date.UTC(2026, 10, 4, 1));
    expect(e.end?.getTime()).toBe(Date.UTC(2026, 10, 4, 2));
    expect(e).toMatchObject({
      uid: "u1",
      title: "Standup",
      allDay: false,
      status: "confirmed",
      myPartstat: null,
    });
    expect(e.sourceLabel).toBeUndefined();
  });

  it("uses the file's VTIMEZONE for TZID times (EST and EDT)", () => {
    const evs = parseIcsEvents(
      cal(
        EASTERN_VTZ,
        vevent("UID:winter", "DTSTART;TZID=Custom/Eastern:20261104T080000", "DTEND;TZID=Custom/Eastern:20261104T090000"),
        vevent("UID:summer", "DTSTART;TZID=Custom/Eastern:20260701T080000"),
      ),
      ctx(WIDE),
    );
    const byUid = Object.fromEntries(evs.map((e) => [e.uid, e]));
    expect(byUid.winter!.start.getTime()).toBe(Date.UTC(2026, 10, 4, 13));
    expect(byUid.winter!.end?.getTime()).toBe(Date.UTC(2026, 10, 4, 14));
    expect(byUid.summer!.start.getTime()).toBe(Date.UTC(2026, 6, 1, 12));
  });

  it("maps VTIMEZONE time to Tokyo local wall clock", () => {
    const [e] = parseIcsEvents(
      cal(EASTERN_VTZ, vevent("UID:x", "DTSTART;TZID=Custom/Eastern:20261104T080000")),
      ctx(),
    );
    expect(e!.start.getHours()).toBe(22);
    expect(e!.start.getDate()).toBe(4);
  });

  it("converts IANA TZIDs without VTIMEZONE (Google style) via Intl", () => {
    const evs = parseIcsEvents(
      cal(
        vevent("UID:ny", "DTSTART;TZID=America/New_York:20261104T100000", "DTEND;TZID=America/New_York:20261104T103000"),
        vevent("UID:ny-dst", "DTSTART;TZID=America/New_York:20260701T100000"),
        vevent("UID:tokyo", "DTSTART;TZID=Asia/Tokyo:20261104T100000"),
      ),
      ctx(WIDE),
    );
    const byUid = Object.fromEntries(evs.map((e) => [e.uid, e]));
    expect(byUid.ny!.start.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(byUid.ny!.end?.toISOString()).toBe("2026-11-04T15:30:00.000Z");
    expect(byUid["ny-dst"]!.start.toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(byUid.tokyo!.start.toISOString()).toBe("2026-11-04T01:00:00.000Z");
  });

  it("places a New York 10:00 event at 00:00 JST inside the 11/04@04:00 window", () => {
    const evs = parseIcsEvents(
      cal(vevent("UID:ny", "DTSTART;TZID=America/New_York:20261104T100000")),
      ctx(),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]!.start.getHours()).toBe(0);
    expect(evs[0]!.start.getDate()).toBe(5);
  });

  it("treats floating times as device local time", () => {
    const [e] = parseIcsEvents(cal(vevent("UID:f", "DTSTART:20261104T100000")), ctx());
    expect(e!.start.getTime()).toBe(new Date(2026, 10, 4, 10, 0).getTime());
    expect(e!.start.toISOString()).toBe("2026-11-04T01:00:00.000Z"); // TZ pinned to Asia/Tokyo
  });

  it("falls back to floating for unknown non-IANA TZIDs", () => {
    const [e] = parseIcsEvents(
      cal(vevent("UID:w", "DTSTART;TZID=Not A Real Zone:20261104T100000")),
      ctx(),
    );
    expect(e!.start.getTime()).toBe(new Date(2026, 10, 4, 10, 0).getTime());
  });
});

describe("parseIcsEvents: recurrence", () => {
  // 2026-11-04 is a Wednesday.
  const weekly = (...extra: string[]) =>
    vevent(
      "UID:weekly",
      "SUMMARY:Weekly",
      "DTSTART;TZID=Asia/Tokyo:20261007T100000",
      "DTEND;TZID=Asia/Tokyo:20261007T110000",
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
      ...extra,
    );

  it("expands a weekly RRULE into the window", () => {
    const evs = parseIcsEvents(cal(weekly()), ctx());
    expect(evs).toHaveLength(1);
    expect(evs[0]!.start.toISOString()).toBe("2026-11-04T01:00:00.000Z");
    expect(evs[0]!.end?.toISOString()).toBe("2026-11-04T02:00:00.000Z");
    expect(evs[0]!.uid).toBe("weekly");
  });

  it("expands all instances across a wide window", () => {
    const window = { start: new Date(Date.UTC(2026, 9, 1)), end: new Date(Date.UTC(2026, 10, 1)) };
    const evs = parseIcsEvents(cal(weekly()), ctx(window));
    expect(evs.map((e) => e.start.toISOString())).toEqual([
      "2026-10-07T01:00:00.000Z",
      "2026-10-14T01:00:00.000Z",
      "2026-10-21T01:00:00.000Z",
      "2026-10-28T01:00:00.000Z",
    ]);
  });

  it("EXDATE on the target day yields no instance", () => {
    expect(parseIcsEvents(cal(weekly("EXDATE;TZID=Asia/Tokyo:20261104T100000")), ctx())).toEqual([]);
  });

  it("EXDATE given in UTC also matches a TZID series", () => {
    expect(parseIcsEvents(cal(weekly("EXDATE:20261104T010000Z")), ctx())).toEqual([]);
  });

  it("RDATE adds an extra instance", () => {
    const evs = parseIcsEvents(
      cal(weekly("RDATE;TZID=Asia/Tokyo:20261104T170000")),
      ctx(),
    );
    expect(evs.map((e) => e.start.getHours())).toEqual([10, 17]);
  });

  it("RECURRENCE-ID override moving 10:00 → 15:00 yields only the 15:00 instance", () => {
    const evs = parseIcsEvents(
      cal(
        weekly(),
        vevent(
          "UID:weekly",
          "SUMMARY:Weekly (moved)",
          "RECURRENCE-ID;TZID=Asia/Tokyo:20261104T100000",
          "DTSTART;TZID=Asia/Tokyo:20261104T150000",
          "DTEND;TZID=Asia/Tokyo:20261104T153000",
        ),
      ),
      ctx(),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]!.start.getHours()).toBe(15);
    expect(evs[0]!.end?.getMinutes()).toBe(30);
    expect(evs[0]!.title).toBe("Weekly (moved)");
    expect(evs[0]!.uid).toBe("weekly");
  });

  it("cancelled override yields status cancelled", () => {
    const evs = parseIcsEvents(
      cal(
        weekly(),
        vevent(
          "UID:weekly",
          "RECURRENCE-ID;TZID=Asia/Tokyo:20261104T100000",
          "DTSTART;TZID=Asia/Tokyo:20261104T100000",
          "DTEND;TZID=Asia/Tokyo:20261104T110000",
          "STATUS:CANCELLED",
        ),
      ),
      ctx(),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]!.status).toBe("cancelled");
  });

  it("override moving an instance out of the window removes it", () => {
    const evs = parseIcsEvents(
      cal(
        weekly(),
        vevent(
          "UID:weekly",
          "RECURRENCE-ID;TZID=Asia/Tokyo:20261104T100000",
          "DTSTART;TZID=Asia/Tokyo:20261106T100000",
        ),
      ),
      ctx(),
    );
    expect(evs).toEqual([]);
  });

  it("override moving an instance into the window adds it (series rule beyond window)", () => {
    const evs = parseIcsEvents(
      cal(
        weekly(),
        vevent(
          "UID:weekly",
          "RECURRENCE-ID;TZID=Asia/Tokyo:20261111T100000",
          "DTSTART;TZID=Asia/Tokyo:20261104T180000",
        ),
      ),
      ctx(),
    );
    expect(evs.map((e) => e.start.getHours())).toEqual([10, 18]);
    // Sparse override without DTEND inherits the master's 1h duration.
    expect(evs[1]!.end!.getTime() - evs[1]!.start.getTime()).toBe(60 * 60 * 1000);
  });

  it("handles an infinite daily rule starting long ago", () => {
    const evs = parseIcsEvents(
      cal(vevent("UID:daily", "DTSTART:20000101T000000Z", "RRULE:FREQ=DAILY")),
      ctx(),
    );
    expect(evs.map((e) => e.start.toISOString())).toEqual(["2026-11-04T00:00:00.000Z"]);
  });

  it("respects UNTIL and COUNT", () => {
    const until = parseIcsEvents(cal(weekly().replace("BYDAY=WE", "BYDAY=WE;UNTIL=20261103T000000Z")), ctx());
    expect(until).toEqual([]);
    const count = parseIcsEvents(cal(weekly().replace("BYDAY=WE", "BYDAY=WE;COUNT=5")), ctx());
    expect(count).toHaveLength(1); // 10/07,14,21,28,11/04
  });

  it("orphan override (no master in file) is returned as a standalone instance", () => {
    const evs = parseIcsEvents(
      cal(
        vevent(
          "UID:orphan",
          "RECURRENCE-ID;TZID=Asia/Tokyo:20261104T100000",
          "DTSTART;TZID=Asia/Tokyo:20261104T120000",
        ),
      ),
      ctx(),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]!.start.getHours()).toBe(12);
    expect(evs[0]!.end).toBeNull();
  });
});

describe("parseIcsEvents: window semantics", () => {
  const at = (uid: string, local: string) => vevent(`UID:${uid}`, `DTSTART;TZID=Asia/Tokyo:${local}`);

  it("applies the 04:00 day boundary (half-open)", () => {
    const evs = parseIcsEvents(
      cal(
        at("before-boundary", "20261104T020000"),
        at("at-start", "20261104T040000"),
        at("after-midnight", "20261105T020000"),
        at("at-end", "20261105T040000"),
      ),
      ctx(),
    );
    expect(evs.map((e) => e.uid)).toEqual(["at-start", "after-midnight"]);
  });

  it("all-day events: 11/04 included and 11/05 excluded with boundary 04:00", () => {
    const evs = parseIcsEvents(
      cal(
        vevent("UID:d4", "DTSTART;VALUE=DATE:20261104", "DTEND;VALUE=DATE:20261105"),
        vevent("UID:d5", "DTSTART;VALUE=DATE:20261105", "DTEND;VALUE=DATE:20261106"),
        vevent("UID:d3", "DTSTART;VALUE=DATE:20261103"),
      ),
      ctx(),
    );
    expect(evs).toHaveLength(1);
    const e = evs[0]!;
    expect(e.uid).toBe("d4");
    expect(e.allDay).toBe(true);
    expect(e.start.getTime()).toBe(new Date(2026, 10, 4).getTime());
    expect(e.end?.getTime()).toBe(new Date(2026, 10, 5).getTime());
  });

  it("all-day without DTEND has end null", () => {
    const [e] = parseIcsEvents(cal(vevent("UID:d", "DTSTART;VALUE=DATE:20261104")), ctx());
    expect(e!.allDay).toBe(true);
    expect(e!.end).toBeNull();
  });

  it("isInWindow: all-day equals start-in-window for midnight windows", () => {
    const midnight = windowForDate("2026-11-04", "00:00");
    expect(isInWindow(new Date(2026, 10, 4), true, midnight)).toBe(true);
    expect(isInWindow(new Date(2026, 10, 5), true, midnight)).toBe(false);
    expect(isInWindow(new Date(2026, 10, 3), true, midnight)).toBe(false);
  });

  it("expands weekly all-day series", () => {
    const evs = parseIcsEvents(
      cal(vevent("UID:wa", "DTSTART;VALUE=DATE:20261007", "RRULE:FREQ=WEEKLY")),
      ctx(),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]!.start.getTime()).toBe(new Date(2026, 10, 4).getTime());
    expect(evs[0]!.allDay).toBe(true);
  });
});

describe("parseIcsEvents: end, status, partstat, uid", () => {
  it("computes end from DURATION", () => {
    const [e] = parseIcsEvents(
      cal(vevent("UID:d", "DTSTART:20261104T010000Z", "DURATION:PT45M")),
      ctx(),
    );
    expect(e!.end?.toISOString()).toBe("2026-11-04T01:45:00.000Z");
  });

  it("end is null without DTEND and DURATION", () => {
    const [e] = parseIcsEvents(cal(vevent("UID:n", "DTSTART:20261104T010000Z")), ctx());
    expect(e!.end).toBeNull();
  });

  it("maps STATUS", () => {
    const evs = parseIcsEvents(
      cal(
        vevent("UID:a", "DTSTART:20261104T010000Z", "STATUS:TENTATIVE"),
        vevent("UID:b", "DTSTART:20261104T020000Z", "STATUS:CANCELLED"),
        vevent("UID:c", "DTSTART:20261104T030000Z", "STATUS:CONFIRMED"),
        vevent("UID:d", "DTSTART:20261104T040000Z"),
      ),
      ctx(),
    );
    expect(evs.map((e) => e.status)).toEqual(["tentative", "cancelled", "confirmed", "confirmed"]);
  });

  it("detects declined PARTSTAT with case-insensitive email", () => {
    const ics = cal(
      vevent(
        "UID:p",
        "DTSTART:20261104T010000Z",
        "ATTENDEE;CN=Other;PARTSTAT=ACCEPTED:mailto:other@example.com",
        "ATTENDEE;CN=Me;PARTSTAT=DECLINED:MAILTO:Me@Example.COM",
      ),
    );
    expect(parseIcsEvents(ics, ctx(DAY, "me@example.com"))[0]!.myPartstat).toBe("declined");
    expect(parseIcsEvents(ics, ctx(DAY, "ME@example.com"))[0]!.myPartstat).toBe("declined");
    expect(parseIcsEvents(ics, ctx(DAY))[0]!.myPartstat).toBeNull();
    expect(parseIcsEvents(ics, ctx(DAY, "nobody@example.com"))[0]!.myPartstat).toBeNull();
  });

  it("matched attendee without PARTSTAT defaults to needs-action", () => {
    const ics = cal(vevent("UID:p", "DTSTART:20261104T010000Z", "ATTENDEE:mailto:me@example.com"));
    expect(parseIcsEvents(ics, ctx(DAY, "me@example.com"))[0]!.myPartstat).toBe("needs-action");
  });

  it("missing SUMMARY gives empty title; raw SUMMARY is kept", () => {
    const evs = parseIcsEvents(
      cal(
        vevent("UID:a", "DTSTART:20261104T010000Z"),
        vevent("UID:b", "DTSTART:20261104T020000Z", "SUMMARY:Meeting 10:00 (30)"),
      ),
      ctx(),
    );
    expect(evs.map((e) => e.title)).toEqual(["", "Meeting 10:00 (30)"]);
  });

  it("synthesizes a stable UID when missing", () => {
    const ics = cal(vevent("DTSTART:20261104T010000Z", "SUMMARY:No uid"));
    const a = parseIcsEvents(ics, ctx())[0]!.uid;
    const b = parseIcsEvents(ics, ctx())[0]!.uid;
    expect(a).toMatch(/^synth-[0-9a-f]{8}$/);
    expect(a).toBe(b);
    const other = cal(vevent("DTSTART:20261104T020000Z", "SUMMARY:No uid"));
    expect(parseIcsEvents(other, ctx())[0]!.uid).not.toBe(a);
  });

  it("sets sourceLabel and sorts by start", () => {
    const evs = parseIcsEvents(
      cal(vevent("UID:late", "DTSTART:20261104T050000Z"), vevent("UID:early", "DTSTART:20261104T010000Z")),
      ctx(),
      { sourceLabel: "Work" },
    );
    expect(evs.map((e) => e.uid)).toEqual(["early", "late"]);
    expect(evs.every((e) => e.sourceLabel === "Work")).toBe(true);
  });

  it("accepts LF-only line endings", () => {
    const ics = cal(vevent("UID:lf", "DTSTART:20261104T010000Z")).replace(/\r\n/g, "\n");
    expect(parseIcsEvents(ics, ctx())).toHaveLength(1);
  });

  it("skips a broken VEVENT but keeps the rest", () => {
    const evs = parseIcsEvents(
      cal(
        vevent("UID:nostart", "SUMMARY:No DTSTART"),
        vevent("UID:ok", "DTSTART:20261104T020000Z"),
      ),
      ctx(),
    );
    expect(evs.map((e) => e.uid)).toContain("ok");
    expect(evs.map((e) => e.uid)).not.toContain("nostart");
  });
});

describe("parseIcsEvents: malformed input", () => {
  const expectParseError = (text: string) => {
    try {
      parseIcsEvents(text, ctx(), { sourceLabel: "Cal" });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SourceError);
      expect((e as SourceError).kind).toBe("parse");
      expect((e as SourceError).sourceLabel).toBe("Cal");
    }
  };

  it("throws SourceError(parse) for garbage", () => expectParseError("<html>Not found</html>"));
  it("throws SourceError(parse) for empty text", () => expectParseError("   "));
  it("throws SourceError(parse) for unterminated calendar", () =>
    expectParseError("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261104T010000Z"));
  // ical.js validates RRULE syntax while parsing the file, so this is file-level.
  it("throws SourceError(parse) for a syntactically invalid RRULE", () =>
    expectParseError(
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261104T010000Z\r\nRRULE:FREQ=NOPE\r\nEND:VEVENT\r\nEND:VCALENDAR",
    ));
  it("throws SourceError(parse) when root is not VCALENDAR", () =>
    expectParseError("BEGIN:VCARD\r\nVERSION:4.0\r\nFN:X\r\nEND:VCARD"));
});
