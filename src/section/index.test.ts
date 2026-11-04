import { describe, expect, it } from "vitest";
import { minutesFromBoundary } from "../time";
import { assignSection, findHeadings, locateSection, matchHeading, normalizeSections } from "./index";

const B = "04:00";
const defs = [
  { start: "18:00", heading: "夜" },
  { start: "5:00", heading: " 朝 " },
  { start: "12:00", heading: "午後" },
  { start: "10:00", heading: "   " },
];

describe("normalizeSections", () => {
  it("drops empty headings, trims, pads and sorts by boundary", () => {
    expect(normalizeSections(defs, B)).toEqual([
      { start: "05:00", heading: "朝" },
      { start: "12:00", heading: "午後" },
      { start: "18:00", heading: "夜" },
    ]);
  });
  it("sorts sections after midnight last", () => {
    const s = normalizeSections([{ start: "01:00", heading: "深夜" }, { start: "23:00", heading: "夜" }], B);
    expect(s.map((x) => x.heading)).toEqual(["夜", "深夜"]);
  });
  it("rejects invalid times and duplicate starts", () => {
    expect(() => normalizeSections([{ start: "25:00", heading: "x" }], B)).toThrow(/Invalid section start/);
    expect(() =>
      normalizeSections([{ start: "5:00", heading: "a" }, { start: "05:00", heading: "b" }], B),
    ).toThrow(/Duplicate section start time 05:00/);
  });
});

describe("assignSection", () => {
  const s = normalizeSections(defs, B);
  const at = (t: string) => assignSection(minutesFromBoundary(t, B), s, B);
  it("assigns per decision 0.1-3", () => {
    expect(at("04:30")).toBe(0); // boundary..first section → first
    expect(at("05:00")).toBe(0);
    expect(at("11:59")).toBe(0);
    expect(at("12:00")).toBe(1);
    expect(at("18:00")).toBe(2);
    expect(at("23:59")).toBe(2);
    expect(at("01:30")).toBe(2); // next day before boundary → last
    expect(at("03:59")).toBe(2);
  });
  it("empty list → -1", () => {
    expect(assignSection(10, [], B)).toBe(-1);
  });
});

describe("findHeadings", () => {
  it("finds ATX headings, skipping frontmatter, fences and #tags", () => {
    const note = [
      "---",
      "title: x",
      "# not heading",
      "---",
      "# Title #",
      "#tag line",
      "```md",
      "## in code",
      "```",
      "~~~~",
      "## still code",
      "~~~",
      "~~~~",
      "### C# ##",
      "####### seven",
      "##",
    ].join("\n");
    expect(findHeadings(note)).toEqual([
      { line: 4, level: 1, text: "Title" },
      { line: 13, level: 3, text: "C#" },
      { line: 15, level: 2, text: "" },
    ]);
  });
  it("unclosed frontmatter is not frontmatter", () => {
    expect(findHeadings("---\n# a")).toEqual([{ line: 1, level: 1, text: "a" }]);
  });
});

describe("matchHeading", () => {
  it("exact: trimmed, NFC, ASCII case-insensitive", () => {
    expect(matchHeading("朝", "  朝 ", "exact")).toBe(true);
    expect(matchHeading("Calendar", "calendar", "exact")).toBe(true);
    expect(matchHeading("朝", "朝の予定", "exact")).toBe(false);
    expect(matchHeading("\u30AC", "\u30AB\u3099", "exact")).toBe(true); // NFC vs NFD
    expect(matchHeading("", "", "exact")).toBe(false);
  });
  it("partial: heading includes label", () => {
    expect(matchHeading("朝", "🌅 朝の予定", "partial")).toBe(true);
    expect(matchHeading("pm", "Afternoon (PM)", "partial")).toBe(true);
    expect(matchHeading("夜", "朝", "partial")).toBe(false);
  });
});

describe("locateSection", () => {
  const note = ["# 2026-11-04", "## 朝", "- a", "### sub", "- b", "## 午後", "- c"].join("\n");
  it("body ends before next heading of same or higher level", () => {
    expect(locateSection(note, "朝", "exact")).toEqual({ headingLine: 1, bodyStart: 2, bodyEnd: 5 });
    expect(locateSection(note, "午後", "exact")).toEqual({ headingLine: 5, bodyStart: 6, bodyEnd: 7 });
    expect(locateSection(note, "夜", "exact")).toBeNull();
  });
  it("first match wins", () => {
    expect(locateSection("## 朝\n## 朝", "朝", "exact")?.headingLine).toBe(0);
  });
});
