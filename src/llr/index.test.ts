import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../types";
import {
  buildLlrLine,
  computeEstimateMinutes,
  formatEstimate,
  parseTaskLine,
  planLine,
  sanitizeTitle,
  type PlanLineOptions,
} from "./index";

const opts: PlanLineOptions = {
  boundary: "04:00",
  defaultDurationMinutes: 30,
  estimateFormat: "m",
  titlePrefix: "",
  prefixWithCalendarLabel: false,
  tentativePrefix: "",
};

function ev(over: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    uid: "uid-1",
    start: new Date(2026, 10, 4, 9, 0),
    end: new Date(2026, 10, 4, 9, 30),
    allDay: false,
    title: "定例",
    status: "confirmed",
    myPartstat: null,
    ...over,
  };
}

describe("sanitizeTitle", () => {
  it("normalizes whitespace", () => {
    expect(sanitizeTitle("  a\r\nb\t\tc   d  ")).toBe("a b c d");
  });
  it("replaces time colons with U+2236", () => {
    expect(sanitizeTitle("Meeting 10:00")).toBe("Meeting 10∶00");
    expect(sanitizeTitle("9:30開始")).toBe("9∶30開始");
    expect(sanitizeTitle("Note: ratio")).toBe("Note: ratio");
  });
  it("fullwidths estimate-looking parens anywhere", () => {
    expect(sanitizeTitle("Review (30)")).toBe("Review （30）");
    for (const p of ["(30m)", "(1h)", "(1.5h)", "(30 > 25)", "(30m > 25m)"]) {
      const out = sanitizeTitle(`x ${p} y`);
      expect(out).not.toContain("(");
      expect(out).toContain("（");
    }
    expect(sanitizeTitle("(ランチ) meet")).toBe("(ランチ) meet");
  });
  it("neutralizes @ markers", () => {
    expect(sanitizeTitle("Party @done")).toBe("Party ＠done");
    expect(sanitizeTitle("Due @1105 @11/05")).toBe("Due ＠1105 ＠11/05");
  });
  it("empty → (無題)", () => {
    expect(sanitizeTitle("")).toBe("(無題)");
    expect(sanitizeTitle(" \r\n\t ")).toBe("(無題)");
  });
  it("is idempotent", () => {
    for (const t of ["Sync 10:00 (30m) @done", "", "a(1h)b"]) {
      expect(sanitizeTitle(sanitizeTitle(t))).toBe(sanitizeTitle(t));
    }
  });
});

describe("estimate", () => {
  it("formats minutes and hours", () => {
    expect(formatEstimate(30, "m")).toBe("30m");
    expect(formatEstimate(90, "m")).toBe("90m");
    expect(formatEstimate(90, "h")).toBe("1.5h");
    expect(formatEstimate(45, "h")).toBe("0.75h");
    expect(formatEstimate(30, "h")).toBe("0.5h");
    expect(formatEstimate(60, "h")).toBe("1h");
    expect(formatEstimate(20, "h")).toBe("0.33h");
    expect(formatEstimate(0, "m")).toBe("1m");
  });
  it("uses default for missing or non-positive end", () => {
    const s = new Date(2026, 10, 4, 9, 0);
    expect(computeEstimateMinutes(s, null, 30)).toBe(30);
    expect(computeEstimateMinutes(s, s, 45)).toBe(45);
    expect(computeEstimateMinutes(s, new Date(2026, 10, 4, 8, 0), 30)).toBe(30);
  });
  it("computes duration and clamps at local midnight", () => {
    expect(computeEstimateMinutes(new Date(2026, 10, 4, 9, 0), new Date(2026, 10, 4, 10, 30), 30)).toBe(90);
    expect(computeEstimateMinutes(new Date(2026, 10, 4, 23, 0), new Date(2026, 10, 5, 1, 0), 30)).toBe(60);
  });
  it("TZ-independent: duration from UTC instants within one local day", () => {
    // Pick a start at local noon so +45m never crosses local midnight in any TZ.
    const s = new Date(2026, 10, 4, 12, 0);
    const e = new Date(s.getTime() + 45 * 60000);
    expect(computeEstimateMinutes(s, e, 30)).toBe(45);
  });
});

describe("buildLlrLine", () => {
  it("builds timed and all-day lines", () => {
    expect(buildLlrLine({ time: "09:00", title: "定例", estimateMinutes: 30, format: "m" })).toBe("- [ ] 09:00 定例 (30m)");
    expect(buildLlrLine({ time: "09:00", title: "定例", estimateMinutes: null, format: "m" })).toBe("- [ ] 09:00 定例");
    expect(buildLlrLine({ time: "", title: "休日", estimateMinutes: 30, format: "m" })).toBe("- [ ] 休日");
  });
});

describe("planLine", () => {
  it("plans a basic event", () => {
    const p = planLine(ev({}), opts);
    expect(p).toEqual({
      key: { uid: "uid-1", startIso: new Date(2026, 10, 4, 9, 0).toISOString() },
      title: "定例",
      time: "09:00",
      minutesFromBoundary: 300,
      line: "- [ ] 09:00 定例 (30m)",
    });
  });
  it("applies tentative prefix, calendar label and title prefix", () => {
    const o = { ...opts, prefixWithCalendarLabel: true, tentativePrefix: "(仮) ", titlePrefix: "★" };
    expect(planLine(ev({ status: "tentative", sourceLabel: "Work" }), o).title).toBe("(仮) [Work] ★定例");
    expect(planLine(ev({ myPartstat: "tentative", sourceLabel: "Work" }), o).title).toBe("(仮) [Work] ★定例");
    expect(planLine(ev({ sourceLabel: "Work" }), o).title).toBe("[Work] ★定例");
    expect(planLine(ev({}), o).title).toBe("★定例");
    expect(planLine(ev({ status: "tentative" }), opts).title).toBe("定例");
  });
  it("sanitizes prefixes too", () => {
    const o = { ...opts, titlePrefix: "@cal 10:00 " };
    expect(planLine(ev({}), o).title).toBe("＠cal 10∶00 定例");
  });
  it("empty title → (無題), even with prefix", () => {
    expect(planLine(ev({ title: "  " }), opts).line).toBe("- [ ] 09:00 (無題) (30m)");
    expect(planLine(ev({ title: "" }), { ...opts, titlePrefix: "P:" }).title).toBe("P:(無題)");
  });
  it("after-midnight event: boundary-relative minutes and clamped estimate", () => {
    const p = planLine(ev({ start: new Date(2026, 10, 5, 1, 0), end: new Date(2026, 10, 5, 2, 0) }), opts);
    expect(p.time).toBe("01:00");
    expect(p.minutesFromBoundary).toBe(21 * 60);
    expect(p.line).toBe("- [ ] 01:00 定例 (60m)");
  });
  it("uses h format and default duration", () => {
    const p = planLine(ev({ end: null }), { ...opts, estimateFormat: "h", defaultDurationMinutes: 90 });
    expect(p.line).toBe("- [ ] 09:00 定例 (1.5h)");
  });
  it("all-day events have no time or estimate", () => {
    const p = planLine(ev({ allDay: true, start: new Date(2026, 10, 4), end: new Date(2026, 10, 5), title: "祝日" }), opts);
    expect(p.time).toBe("");
    expect(p.minutesFromBoundary).toBe(0);
    expect(p.line).toBe("- [ ] 祝日");
  });
});

describe("acceptance #11: titles cannot break LLR parsing", () => {
  const titles = ["Sync 10:00", "Review (30)", "Plan (1h)", "Party @done", "Due @1105"];
  for (const title of titles) {
    it(title, () => {
      const p = planLine(ev({ title, start: new Date(2026, 10, 4, 14, 5), end: new Date(2026, 10, 4, 14, 35) }), opts);
      const parsed = parseTaskLine(p.line);
      expect(parsed?.time).toBe("14:05");
      expect(parsed?.status).toBe(" ");
      // Only the generated estimate may remain as ASCII "(digits…)".
      const rest = (parsed?.rest ?? "").replace(/ \(30m\)$/, "");
      expect(rest).not.toMatch(/\d{1,2}:\d{2}/);
      expect(rest).not.toMatch(/\(\s*\d/);
      expect(rest).not.toMatch(/@/);
      expect(p.line.endsWith(" (30m)")).toBe(true);
    });
  }
});

describe("parseTaskLine", () => {
  it("parses the three LLR states", () => {
    expect(parseTaskLine("- [ ] 09:00 foo (30m)")).toEqual({ indent: "", status: " ", time: "09:00", rest: "foo (30m)" });
    expect(parseTaskLine("- [/] 09:00 foo 09:02 - (30m)")).toEqual({
      indent: "",
      status: "/",
      time: "09:00",
      rest: "foo 09:02 - (30m)",
    });
    expect(parseTaskLine("- [x] 09:00 foo 09:02 - 09:30 (30m > 28m)")).toEqual({
      indent: "",
      status: "x",
      time: "09:00",
      rest: "foo 09:02 - 09:30 (30m > 28m)",
    });
  });
  it("handles '*' bullets, indentation, H:mm and missing time", () => {
    expect(parseTaskLine("* [ ] 9:05 bar")).toEqual({ indent: "", status: " ", time: "09:05", rest: "bar" });
    expect(parseTaskLine("    - [ ] 23:59 late")).toMatchObject({ indent: "    ", time: "23:59" });
    expect(parseTaskLine("\t- [x] no time")).toEqual({ indent: "\t", status: "x", time: null, rest: "no time" });
    expect(parseTaskLine("- [ ] 25:00 bad")).toMatchObject({ time: null, rest: "25:00 bad" });
    expect(parseTaskLine("- [ ] 10:00")).toMatchObject({ time: "10:00", rest: "" });
    expect(parseTaskLine("- [ ]")).toMatchObject({ time: null, rest: "" });
  });
  it("returns null for non-task lines", () => {
    for (const l of ["", "## 朝", "- memo 09:00", "plain text", "-[ ] 09:00 x", "- [] 09:00 x", "1. [ ] 09:00 x"]) {
      expect(parseTaskLine(l)).toBeNull();
    }
  });
});
