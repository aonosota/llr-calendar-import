import { describe, expect, it } from "vitest";
import type { InsertRecord, PlannedLine } from "../types";
import { minutesFromBoundary } from "../time";
import { normalizeSections } from "../section";
import { decideDedupe, insertLines, type InsertOptions } from "./index";

// All inputs are plain strings (no Date), so these tests are TZ-independent.
const B = "04:00";

function pl(time: string, title: string, uid = title, startIso = `2026-11-04T${time || "00:00"}`): PlannedLine {
  return {
    key: { uid, startIso },
    title,
    time,
    minutesFromBoundary: time ? minutesFromBoundary(time, B) : 0,
    line: time ? `- [ ] ${time} ${title} (30m)` : `- [ ] ${title}`,
  };
}

const opts: InsertOptions = {
  sections: normalizeSections(
    [
      { start: "05:00", heading: "朝" },
      { start: "12:00", heading: "午後" },
      { start: "18:00", heading: "夜" },
    ],
    B,
  ),
  boundary: B,
  headingMatch: "exact",
  fallbackHeading: "## Calendar",
};

const base = [
  "# 2026-11-04",
  "## 朝",
  "朝のメモ。散歩する。",
  "- [ ] 08:00 起床ルーチン (15m)",
  "- [x] 10:00 メール 10:01 - 10:20 (30m > 19m)",
  "",
  "## 午後",
  "- [ ] 13:00 昼会 (30m)",
  "",
  "## 夜",
  "- [ ] 23:00 読書 (30m)",
  "",
].join("\n");

const run = (note: string, items: PlannedLine[], o: Partial<InsertOptions> = {}) =>
  insertLines(note, items, { ...opts, ...o });

describe("insertLines: sections and ordering", () => {
  it("places 09:00 between 08:00 and 10:00 under 朝 without touching existing lines", () => {
    const { text, placements } = run(base, [pl("09:00", "定例")]);
    const lines = text.split("\n");
    expect(lines.slice(1, 6)).toEqual([
      "## 朝",
      "朝のメモ。散歩する。",
      "- [ ] 08:00 起床ルーチン (15m)",
      "- [ ] 09:00 定例 (30m)",
      "- [x] 10:00 メール 10:01 - 10:20 (30m > 19m)",
    ]);
    // Removing the inserted line yields the original note exactly.
    expect(lines.filter((l) => l !== "- [ ] 09:00 定例 (30m)").join("\n")).toBe(base);
    expect(placements).toEqual([{ key: pl("09:00", "定例").key, sectionIndex: 0, heading: "朝" }]);
  });

  it("running/done LLR lines count as task lines for ordering", () => {
    const note = "## 朝\n- [x] 09:00 定例 09:02 - 09:30 (30m > 28m)\n- [/] 11:00 作業 11:05 - (60m)\n";
    const { text } = run(note, [pl("10:00", "A"), pl("09:00", "B")]);
    expect(text).toBe(
      "## 朝\n- [x] 09:00 定例 09:02 - 09:30 (30m > 28m)\n- [ ] 09:00 B (30m)\n- [ ] 10:00 A (30m)\n- [/] 11:00 作業 11:05 - (60m)\n",
    );
  });

  it("same time keeps input order", () => {
    const { text } = run("## 朝\n", [pl("09:00", "一"), pl("09:00", "二"), pl("09:00", "三")]);
    expect(text).toBe("## 朝\n- [ ] 09:00 一 (30m)\n- [ ] 09:00 二 (30m)\n- [ ] 09:00 三 (30m)\n");
  });

  it("04:30 → first section; 01:30 next day → last section after 23:00", () => {
    const { text, placements } = run(base, [pl("04:30", "早朝"), pl("01:30", "深夜")]);
    const lines = text.split("\n");
    expect(lines[3]).toBe("- [ ] 04:30 早朝 (30m)"); // before 08:00, after prose
    expect(lines.indexOf("- [ ] 01:30 深夜 (30m)")).toBe(lines.indexOf("- [ ] 23:00 読書 (30m)") + 1);
    expect(placements.map((p) => p.heading)).toEqual(["朝", "夜"]);
  });

  it("section without list lines → directly under heading (prose kept below)", () => {
    const note = "## 朝\n\nメモだけ\n## 午後\n";
    expect(run(note, [pl("07:00", "x")]).text).toBe("## 朝\n- [ ] 07:00 x (30m)\n\nメモだけ\n## 午後\n");
  });

  it("appends after last list line including its continuation lines, before blank lines", () => {
    const note = "## 午後\n- [ ] 13:00 a (30m)\n  - 子メモ\n    続き\n\n## 夜\n";
    expect(run(note, [pl("14:00", "b")]).text).toBe(
      "## 午後\n- [ ] 13:00 a (30m)\n  - 子メモ\n    続き\n- [ ] 14:00 b (30m)\n\n## 夜\n",
    );
  });

  it("subsection lines belong to the section; next same-level heading ends it", () => {
    const note = "## 朝\n### 詳細\n- memo\n## 午後\n- [ ] 13:00 a\n";
    expect(run(note, [pl("09:00", "x")]).text).toBe("## 朝\n### 詳細\n- memo\n- [ ] 09:00 x (30m)\n## 午後\n- [ ] 13:00 a\n");
  });

  it("headings inside code fences are ignored", () => {
    const note = "```\n## 朝\n```\n## 朝\n- [ ] 08:00 a\n";
    expect(run(note, [pl("09:00", "x")]).text).toBe("```\n## 朝\n```\n## 朝\n- [ ] 08:00 a\n- [ ] 09:00 x (30m)\n");
  });

  it("preserves CRLF and missing trailing newline", () => {
    const crlf = "## 朝\r\n- [ ] 08:00 a\r\n## 午後\r\n";
    expect(run(crlf, [pl("09:00", "x")]).text).toBe("## 朝\r\n- [ ] 08:00 a\r\n- [ ] 09:00 x (30m)\r\n## 午後\r\n");
    expect(run("## 朝", [pl("09:00", "x")]).text).toBe("## 朝\n- [ ] 09:00 x (30m)");
  });

  it("partial heading match", () => {
    const note = "## 🌅 朝の予定\n";
    expect(run(note, [pl("09:00", "x")], { headingMatch: "partial" }).placements[0]?.sectionIndex).toBe(0);
    expect(run(note, [pl("09:00", "x")]).placements[0]?.sectionIndex).toBeNull();
  });
});

describe("insertLines: fallback", () => {
  const noAfternoon = "## 朝\n- [ ] 08:00 a\n\n## 夜\n- [ ] 20:00 b\n";

  it("missing section heading → creates ## Calendar at end; second run appends under it", () => {
    const first = run(noAfternoon, [pl("13:00", "歯医者")]);
    expect(first.text).toBe(noAfternoon + "\n## Calendar\n- [ ] 13:00 歯医者 (30m)\n");
    expect(first.placements[0]).toMatchObject({ sectionIndex: null, heading: "## Calendar" });
    const second = run(first.text, [pl("15:30", "打ち合わせ")]);
    expect(second.text).toBe(noAfternoon + "\n## Calendar\n- [ ] 13:00 歯医者 (30m)\n- [ ] 15:30 打ち合わせ (30m)\n");
    expect(second.text.match(/## Calendar/g)).toHaveLength(1);
    // Never creates section headings.
    expect(second.text).not.toContain("## 午後");
  });

  it("exactly one blank line before the created heading", () => {
    expect(run("text", [pl("13:00", "x")]).text).toBe("text\n\n## Calendar\n- [ ] 13:00 x (30m)");
    expect(run("text\n\n", [pl("13:00", "x")]).text).toBe("text\n\n## Calendar\n- [ ] 13:00 x (30m)\n");
    expect(run("", [pl("13:00", "x")]).text).toBe("## Calendar\n- [ ] 13:00 x (30m)");
  });

  it("existing fallback heading in the middle: appends at end of its section", () => {
    const note = "## Calendar\n- [ ] 13:00 a\n\n## メモ\n";
    expect(run(note, [pl("09:00", "x")], { sections: [] }).text).toBe(
      "## Calendar\n- [ ] 13:00 a\n- [ ] 09:00 x (30m)\n\n## メモ\n",
    );
  });

  it("empty section list and all-day items go to fallback", () => {
    const r = run("## 朝\n", [pl("09:00", "a")], { sections: [] });
    expect(r.placements[0]?.sectionIndex).toBeNull();
    const d = run("## 朝\n", [pl("", "誕生日")]);
    expect(d.text).toBe("## 朝\n\n## Calendar\n- [ ] 誕生日\n");
  });

  it("allDayToFallback=false puts all-day items at the top of the first section", () => {
    const d = run("## 朝\nメモ\n- [ ] 08:00 a\n", [pl("", "誕生日")], { allDayToFallback: false });
    expect(d.text).toBe("## 朝\nメモ\n- [ ] 誕生日\n- [ ] 08:00 a\n");
  });

  it("fallback heading in a code fence is not reused", () => {
    const note = "```\n## Calendar\n```\n";
    expect(run(note, [pl("13:00", "x")], { sections: [] }).text).toBe(
      "```\n## Calendar\n```\n\n## Calendar\n- [ ] 13:00 x (30m)\n",
    );
  });

  it("rejects a fallback heading that is not a heading", () => {
    expect(() => run("", [], { fallbackHeading: "Calendar" })).toThrow(/Fallback heading/);
  });
});

describe("decideDedupe", () => {
  const rec = (uid: string, startIso: string, title: string): InsertRecord => ({
    uid,
    startIso,
    title,
    notePath: "Daily/2026-11-04.md",
    date: "2026-11-04",
    insertedAt: "2026-11-04T00:00:00.000Z",
  });
  const item = pl("09:00", "定例", "u1", "2026-11-04T00:00:00.000Z");

  it("duplicate by record", () => {
    expect(decideDedupe(item, [rec("u1", "2026-11-04T00:00:00.000Z", "定例")], "")).toEqual({ kind: "duplicate" });
  });
  it("changed: same uid, different start", () => {
    expect(decideDedupe(item, [rec("u1", "2026-11-04T01:00:00.000Z", "定例")], "")).toEqual({ kind: "changed" });
  });
  it("changed: same uid, different title", () => {
    expect(decideDedupe(item, [rec("u1", "2026-11-04T00:00:00.000Z", "旧定例")], "")).toEqual({ kind: "changed" });
  });
  it("changed record but identical line already in note → duplicate", () => {
    const note = "- [ ] 09:00 定例 (30m)";
    expect(decideDedupe(item, [rec("u1", "2026-11-04T01:00:00.000Z", "定例")], note)).toEqual({ kind: "duplicate" });
  });
  it("new when nothing matches", () => {
    expect(decideDedupe(item, [rec("other", "2026-11-04T00:00:00.000Z", "定例")], "")).toEqual({ kind: "new" });
  });
  it("note fallback ignores checkbox state and LLR running/done suffixes", () => {
    for (const line of [
      "- [ ] 09:00 定例 (30m)",
      "- [/] 09:00 定例 09:02 - (30m)",
      "- [x] 09:00 定例 09:02 - 09:30 (30m > 28m)",
      "  * [x] 9:00 定例",
    ]) {
      expect(decideDedupe(item, [], `## 朝\r\n${line}\r\n`)).toEqual({ kind: "duplicate" });
    }
  });
  it("note fallback requires same time and a title boundary", () => {
    expect(decideDedupe(item, [], "- [ ] 10:00 定例 (30m)")).toEqual({ kind: "new" });
    expect(decideDedupe(item, [], "- [ ] 09:00 定例会議 (30m)")).toEqual({ kind: "new" });
    expect(decideDedupe(item, [], "- 09:00 定例 (30m)")).toEqual({ kind: "new" });
  });
  it("all-day fallback matches untimed task lines only", () => {
    const allDay = pl("", "誕生日", "u2");
    expect(decideDedupe(allDay, [], "- [x] 誕生日")).toEqual({ kind: "duplicate" });
    expect(decideDedupe(allDay, [], "- [ ] 誕生日会")).toEqual({ kind: "new" });
    expect(decideDedupe(allDay, [], "- [ ] 09:00 誕生日")).toEqual({ kind: "new" });
  });
});
