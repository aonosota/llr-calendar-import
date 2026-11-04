import { describe, expect, it } from "vitest";
import { SourceError } from "../../types";
import type { CalendarConfig, FetchContext, TextFetcher } from "../../types";
import { windowForDate } from "../../time";
import { createIcsSource, maskUrl, normalizeIcsUrl } from "./index";

const SECRET_URL = "https://calendar.google.com/calendar/ical/me%40example.com/private-abc123/basic.ics";
const config: CalendarConfig = { id: "c1", url: SECRET_URL, label: "Work", enabled: true };
const ctx: FetchContext = { window: windowForDate("2026-11-04", "04:00") };

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:e1",
  "DTSTART:20261104T010000Z",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

async function catchError(p: Promise<unknown>): Promise<SourceError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SourceError);
    return e as SourceError;
  }
  throw new Error("expected rejection");
}

describe("createIcsSource", () => {
  it("fetches and parses, tagging sourceLabel", async () => {
    const calls: string[] = [];
    const fetcher: TextFetcher = async (url) => {
      calls.push(url);
      return { status: 200, text: ICS };
    };
    const src = createIcsSource(config, fetcher);
    expect(src.id).toBe("c1");
    expect(src.label).toBe("Work");
    const evs = await src.fetchEvents(ctx);
    expect(calls).toEqual([SECRET_URL]);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.sourceLabel).toBe("Work");
  });

  it("HTTP 404 → SourceError(http) without the URL", async () => {
    const src = createIcsSource(config, async () => ({ status: 404, text: "Not Found" }));
    const err = await catchError(src.fetchEvents(ctx));
    expect(err.kind).toBe("http");
    expect(err.message).toContain("404");
    expect(err.message).toContain("Work");
    expect(err.message).not.toContain(SECRET_URL);
    expect(err.message).not.toContain("calendar.google.com");
    expect(err.sourceLabel).toBe("Work");
  });

  it("network throw → SourceError(fetch) without leaking the underlying message", async () => {
    const src = createIcsSource(config, async (url) => {
      throw new Error(`net::ERR_FAILED ${url}`);
    });
    const err = await catchError(src.fetchEvents(ctx));
    expect(err.kind).toBe("fetch");
    expect(err.message).not.toContain(SECRET_URL);
    expect(err.message).not.toContain("private-abc123");
  });

  it("invalid body → SourceError(parse) without the URL", async () => {
    const src = createIcsSource(config, async () => ({ status: 200, text: "<html></html>" }));
    const err = await catchError(src.fetchEvents(ctx));
    expect(err.kind).toBe("parse");
    expect(err.message).not.toContain(SECRET_URL);
  });

  it("uses the id in messages when there is no label", async () => {
    const src = createIcsSource({ id: "cal-x", url: SECRET_URL, enabled: true }, async () => ({
      status: 500,
      text: "",
    }));
    const err = await catchError(src.fetchEvents(ctx));
    expect(err.message).toContain("cal-x");
    expect(err.message).toContain("500");
  });

  it("rewrites webcal:// to https:// before fetching", async () => {
    const calls: string[] = [];
    const src = createIcsSource(
      { ...config, url: "webcal://p01-calendars.icloud.com/published/2/abc" },
      async (url) => {
        calls.push(url);
        return { status: 200, text: ICS };
      },
    );
    await src.fetchEvents(ctx);
    expect(calls).toEqual(["https://p01-calendars.icloud.com/published/2/abc"]);
  });
});

describe("normalizeIcsUrl", () => {
  it("handles webcal case-insensitively and leaves https alone", () => {
    expect(normalizeIcsUrl("WEBCAL://a.example/x.ics")).toBe("https://a.example/x.ics");
    expect(normalizeIcsUrl("https://a.example/x.ics")).toBe("https://a.example/x.ics");
  });
});

describe("maskUrl", () => {
  it("keeps scheme and host only", () => {
    expect(maskUrl(SECRET_URL)).toBe("https://calendar.google.com/…(masked)");
  });
  it("drops userinfo and query", () => {
    expect(maskUrl("https://user:token@example.com/cal.ics?key=s3cret")).toBe(
      "https://example.com/…(masked)",
    );
  });
  it("masks unparsable input entirely", () => {
    expect(maskUrl("not a url with secret")).toBe("(masked)");
  });
});
