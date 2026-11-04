import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { translator } from "../i18n/dict";
import {
  isValidFallbackHeading,
  loadPluginData,
  mergeSettings,
  newCalendarId,
  parseKeywords,
  pruneRecords,
  secretIdFor,
  validateSections,
} from "./data";

const rec = (date: string) => ({ uid: "u", startIso: "2026-01-01T00:00:00.000Z", title: "t", notePath: "p", date, insertedAt: "" });

describe("data.json helpers", () => {
  it("mergeSettings fills defaults and drops garbage", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = mergeSettings({ dayBoundary: "05:00", skipDeclined: "no", calendars: [{ id: "a", url: "u" }, 3] });
    expect(s.dayBoundary).toBe("05:00");
    expect(s.skipDeclined).toBe(true);
    expect(s.calendars).toEqual([{ id: "a", url: "u", enabled: true }]);
  });

  it("pruneRecords keeps the last 60 days", () => {
    const out = pruneRecords([rec("2026-09-05"), rec("2026-09-04"), rec("2026-11-04")], "2026-11-04");
    expect(out.map((r) => r.date)).toEqual(["2026-09-05", "2026-11-04"]);
  });

  it("loadPluginData", () => {
    const d = loadPluginData({ records: [rec("2026-11-01"), { uid: "" }], settings: {} }, "2026-11-04");
    expect(d.records).toHaveLength(1);
    expect(d.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("parseKeywords", () => {
    expect(parseKeywords("a, b\n\n c ,")).toEqual(["a", "b", "c"]);
  });

  it("validateSections", () => {
    const t = translator("en");
    expect(validateSections([{ start: "05:00", heading: "朝" }, { start: "12:00", heading: "午後" }], t)).toEqual([]);
    expect(validateSections([{ start: "5:00", heading: "a" }, { start: "05:00", heading: "b" }], t)).toEqual([
      "Duplicate start time 05:00.",
    ]);
    expect(validateSections([{ start: "x", heading: "a" }, { start: "x", heading: "" }], t)).toEqual([
      "Section 1: start must be HH:mm.",
    ]);
  });

  it("fallback heading / ids", () => {
    expect(isValidFallbackHeading("## Calendar")).toBe(true);
    expect(isValidFallbackHeading("Calendar")).toBe(false);
    expect(secretIdFor("Cal_1")).toBe("llr-cal-cal-1");
    expect(newCalendarId(0, 0)).toMatch(/^[a-z0-9-]+$/);
  });
});
