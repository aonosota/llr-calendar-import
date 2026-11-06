import { describe, expect, it } from "vitest";
import { convertLlrSections, sectionBeforeBoundary } from "./llrSections";

describe("convertLlrSections", () => {
  it("converts the LLR v0.4.2 sample", () => {
    const raw = [
      { time: "0400", label: "朝" },
      { time: "1100", label: "昼" },
      { time: "1600", label: "夕方" },
      { time: "1900", label: "夜" },
    ];
    expect(convertLlrSections(raw)).toEqual({
      sections: [
        { start: "04:00", heading: "朝" },
        { start: "11:00", heading: "昼" },
        { start: "16:00", heading: "夕方" },
        { start: "19:00", heading: "夜" },
      ],
      skipped: 0,
    });
  });
  it("accepts time variants, trims labels, skips invalid", () => {
    const r = convertLlrSections([
      { time: "400", label: " a " },
      { time: "4:00", label: "b" },
      { time: "04:30", label: "c" },
      { time: 1830, label: "d" },
      { time: "2400", label: "x" },
      { time: "0460", label: "x" },
      { time: "abc", label: "x" },
      { time: "0500", label: "  " },
      { time: "0500" },
      null,
      "str",
    ]);
    expect(r.sections.map((s) => `${s.start} ${s.heading}`)).toEqual(["04:00 a", "04:00 b", "04:30 c", "18:30 d"]);
    expect(r.skipped).toBe(7);
  });
  it("non-array input", () => {
    expect(convertLlrSections(undefined)).toEqual({ sections: [], skipped: 0 });
  });
});

describe("sectionBeforeBoundary", () => {
  it("returns the earliest start only when before the boundary", () => {
    const s = [{ start: "04:00", heading: "朝" }, { start: "11:00", heading: "昼" }];
    expect(sectionBeforeBoundary(s, "05:00")).toBe("04:00");
    expect(sectionBeforeBoundary(s, "04:00")).toBeNull();
    expect(sectionBeforeBoundary(s, "bad")).toBeNull();
  });
});
