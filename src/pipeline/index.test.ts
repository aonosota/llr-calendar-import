import { describe, expect, it } from "vitest";
import type { CalendarSource, FetchContext, InsertRecord, NormalizedEvent, PluginSettings } from "../types";
import { DEFAULT_SETTINGS, SourceError } from "../types";
import { windowForDate } from "../time";
import { buildNoticeMessage, filterReason, headingLabel, runImport, validateImportSettings } from "./index";
import type { ImportOutcome, RunImportInput } from "./index";

const DATE = "2026-11-04";
const PATH = "Daily/2026-11-04.md";
const NOW = new Date("2026-11-04T12:00:00Z");
const NOTE = ["# 2026-11-04", "## 朝", "## 午後", "## 夜", ""].join("\n");

const SETTINGS: PluginSettings = {
  ...DEFAULT_SETTINGS,
  sections: [
    { start: "05:00", heading: "朝" },
    { start: "12:00", heading: "午後" },
    { start: "18:00", heading: "夜" },
  ],
  dayBoundary: "04:00",
};

/** Local (Asia/Tokyo) instant on 2026-11-<day>. */
function at(hhmm: string, day = 4): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 10, day, h ?? 0, m ?? 0);
}

function ev(uid: string, hhmm: string, minutes: number, title: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const start = at(hhmm, extra.start ? extra.start.getDate() : 4);
  return {
    uid,
    start,
    end: new Date(start.getTime() + minutes * 60000),
    allDay: false,
    title,
    status: "confirmed",
    myPartstat: null,
    ...extra,
  };
}

interface FakeSource extends CalendarSource {
  calls: FetchContext[];
}

function fake(events: NormalizedEvent[], label?: string, id = "a"): FakeSource {
  const calls: FetchContext[] = [];
  return {
    id,
    label,
    calls,
    async fetchEvents(ctx) {
      calls.push(ctx);
      return events.map((e) => ({ ...e, sourceLabel: label }));
    },
  };
}

function failing(label: string | undefined, err: unknown): CalendarSource {
  return {
    id: "f",
    label,
    async fetchEvents() {
      throw err;
    },
  };
}

function run(sources: CalendarSource[], over: Partial<RunImportInput> = {}): Promise<ImportOutcome> {
  return runImport({
    date: DATE,
    settings: SETTINGS,
    sources,
    noteText: NOTE,
    notePath: PATH,
    records: [],
    now: NOW,
    ...over,
  });
}

function lines(o: ImportOutcome): string[] {
  expect(o.text).not.toBeNull();
  return (o.text ?? "").split("\n");
}

describe("runImport — acceptance", () => {
  it("AC1: inserts an LLR line under the section of its start time", async () => {
    const o = await run([fake([ev("u1", "09:00", 30, "定例")])]);
    expect(o.status).toBe("ok");
    expect(lines(o)).toEqual(["# 2026-11-04", "## 朝", "- [ ] 09:00 定例 (30m)", "## 午後", "## 夜", ""]);
    expect(o.summary).toMatchObject({ inserted: 1, perHeading: { 朝: 1 }, fallback: 0, duplicates: 0, changed: 0 });
    expect(o.records).toEqual([
      { uid: "u1", startIso: at("09:00").toISOString(), title: "定例", notePath: PATH, date: DATE, insertedAt: NOW.toISOString() },
    ]);
  });

  it("AC2: second run inserts nothing and counts duplicates", async () => {
    const src = fake([ev("u1", "09:00", 30, "定例"), ev("u2", "13:00", 60, "歯医者")]);
    const first = await run([src]);
    const second = await run([src], { noteText: first.text ?? "", records: first.records });
    expect(second.text).toBeNull();
    expect(second.records).toEqual([]);
    expect(second.summary).toMatchObject({ inserted: 0, duplicates: 2 });
    // Without records the note-text fallback also catches them.
    const third = await run([src], { noteText: first.text ?? "" });
    expect(third.text).toBeNull();
    expect(third.summary.duplicates).toBe(2);
  });

  it("AC3: a line started/completed in LLR is still a duplicate and is not rewritten", async () => {
    const src = fake([ev("u1", "09:00", 30, "定例")]);
    const first = await run([src]);
    const edited = (first.text ?? "").replace("- [ ] 09:00 定例 (30m)", "- [x] 09:00 定例 09:02 - 09:30 (30m > 28m)");
    for (const records of [first.records, []]) {
      const o = await run([src], { noteText: edited, records });
      expect(o.text).toBeNull();
      expect(o.summary.duplicates).toBe(1);
    }
  });

  it("AC4: existing lines keep their order; new line goes to its time position", async () => {
    const note = ["## 朝", "## 午後", "- [x] 13:00 A (30m)", "メモ", "- [ ] 16:00 B (30m)", "## 夜"].join("\n");
    const o = await run([fake([ev("u3", "15:00", 45, "打ち合わせ")])], { noteText: note });
    expect(lines(o)).toEqual([
      "## 朝",
      "## 午後",
      "- [x] 13:00 A (30m)",
      "メモ",
      "- [ ] 15:00 打ち合わせ (45m)",
      "- [ ] 16:00 B (30m)",
      "## 夜",
    ]);
  });

  it("AC5: missing section heading → fallback heading at the end; no section heading is created", async () => {
    const note = ["## 朝", "## 午後", ""].join("\n");
    const o = await run([fake([ev("u1", "19:00", 30, "夕食"), ev("u2", "09:00", 30, "定例")])], { noteText: note });
    expect(lines(o)).toEqual(["## 朝", "- [ ] 09:00 定例 (30m)", "## 午後", "", "## Calendar", "- [ ] 19:00 夕食 (30m)", ""]);
    expect(o.text).not.toContain("## 夜");
    expect(o.summary).toMatchObject({ inserted: 2, fallback: 1, perHeading: { 朝: 1, Calendar: 1 } });
    expect(buildNoticeMessage(o, "ja", "Calendar")).toBe(
      "2 件を挿入(朝 1)、1 件はセクションが見つからず Calendar に追加",
    );
  });

  it("AC6: day boundary — window, first-section and last-section rules", async () => {
    const src = fake([
      ev("early", "04:30", 30, "早朝"),
      ev("late", "01:30", 30, "深夜", { start: at("01:30", 5) }),
      ev("eve", "23:00", 30, "夜更かし"),
    ]);
    const o = await run([src]);
    expect(src.calls[0]?.window).toEqual(windowForDate(DATE, "04:00"));
    expect(src.calls[0]?.window.start).toEqual(at("04:00", 4));
    expect(src.calls[0]?.window.end).toEqual(at("04:00", 5));
    expect(lines(o)).toEqual([
      "# 2026-11-04",
      "## 朝",
      "- [ ] 04:30 早朝 (30m)",
      "## 午後",
      "## 夜",
      "- [ ] 23:00 夜更かし (30m)",
      "- [ ] 01:30 深夜 (30m)",
      "",
    ]);
    // 2026-11-05 02:00 is requested by the 11/04 note, 2026-11-04 02:00 by the 11/03 note.
    const prev = fake([]);
    await run([prev], { date: "2026-11-03" });
    expect(prev.calls[0]?.window.end).toEqual(at("04:00", 4));
  });

  it("AC7: changed time → new line appended in its new section, old line kept", async () => {
    const first = await run([fake([ev("u1", "09:00", 30, "定例")])]);
    const o = await run([fake([ev("u1", "13:00", 30, "定例")])], { noteText: first.text ?? "", records: first.records });
    expect(lines(o)).toEqual([
      "# 2026-11-04",
      "## 朝",
      "- [ ] 09:00 定例 (30m)",
      "## 午後",
      "- [ ] 13:00 定例 (30m)",
      "## 夜",
      "",
    ]);
    expect(o.summary).toMatchObject({ inserted: 1, changed: 1, duplicates: 0 });
    expect(buildNoticeMessage(o, "ja", "Calendar")).toBe("1 件を挿入(午後 1)、1 件は変更のため追記");
  });

  it("AC10: cancelled never inserted; all-day skipped by default, fallback without time when included", async () => {
    const allDay: NormalizedEvent = { ...ev("ad", "00:00", 0, "休暇"), allDay: true, end: null };
    const src = fake([ev("c", "09:00", 30, "中止", { status: "cancelled" }), allDay]);
    const o = await run([src]);
    expect(o.text).toBeNull();
    expect(o.summary.filtered).toBe(1); // cancelled is not counted
    const inc = await run([src], { settings: { ...SETTINGS, includeAllDay: true } });
    expect(lines(inc)).toEqual(["# 2026-11-04", "## 朝", "## 午後", "## 夜", "", "## Calendar", "- [ ] 休暇", ""]);
    expect(inc.summary).toMatchObject({ inserted: 1, fallback: 1, filtered: 0 });
  });

  it("AC12: one failing source does not stop the others", async () => {
    const o = await run([
      failing("Work", new SourceError('Failed to fetch calendar "Work"', "fetch", "Work")),
      fake([ev("u1", "09:00", 30, "定例")], "Home"),
      failing(undefined, new Error("boom")),
    ]);
    expect(o.status).toBe("ok");
    expect(o.text).toContain("- [ ] 09:00 定例 (30m)");
    expect(o.summary.failedSources).toEqual(["Work", "Calendar 3"]);
    expect(buildNoticeMessage(o, "ja", "Calendar")).toBe("1 件を挿入(朝 1)\n取得失敗: Work\n取得失敗: Calendar 3");
  });

  it("AC13: all sources fail → note unchanged, no URL anywhere", async () => {
    const url = "https://calendar.example.com/private-abc123/basic.ics";
    const o = await run(
      [failing("Work", new Error(`GET ${url} failed`)), failing(undefined, new SourceError(`bad ${url}`, "http"))],
      { unnamedSourceName: (n) => `カレンダー ${n}` },
    );
    expect(o.status).toBe("allFailed");
    expect(o.text).toBeNull();
    expect(o.records).toEqual([]);
    expect(o.summary.failedSources).toEqual(["Work", "カレンダー 2"]);
    const msgJa = buildNoticeMessage(o, "ja", "Calendar");
    const msgEn = buildNoticeMessage(o, "en", "Calendar");
    expect(msgJa).toBe("カレンダーを取得できませんでした。ノートは変更していません。\n取得失敗: Work\n取得失敗: カレンダー 2");
    for (const s of [JSON.stringify(o), msgJa, msgEn]) {
      expect(s).not.toContain(url);
      expect(s).not.toContain("example.com");
    }
  });
});

describe("runImport — details", () => {
  it("dedupes the same event from two calendars into one line", async () => {
    const e = ev("same", "09:00", 30, "定例");
    const o = await run([fake([e], "A", "a"), fake([e], "B", "b")]);
    expect(o.summary).toMatchObject({ inserted: 1, duplicates: 1 });
    expect((o.text ?? "").match(/定例/g)).toHaveLength(1);
  });

  it("orders by start, then source order, then ICS order", async () => {
    const o = await run([
      fake([ev("b1", "10:00", 30, "B1"), ev("b2", "09:00", 30, "B2")], undefined, "b"),
      fake([ev("c1", "09:00", 30, "C1"), ev("c2", "09:00", 30, "C2")], undefined, "c"),
    ]);
    expect(lines(o).slice(1, 6)).toEqual([
      "## 朝",
      "- [ ] 09:00 B2 (30m)",
      "- [ ] 09:00 C1 (30m)",
      "- [ ] 09:00 C2 (30m)",
      "- [ ] 10:00 B1 (30m)",
    ]);
  });

  it("filters declined (when enabled) and exclude keywords (case-insensitive)", async () => {
    const src = fake([
      ev("d", "09:00", 30, "辞退", { myPartstat: "declined" }),
      ev("k", "10:00", 30, "Lunch with Team"),
      ev("ok", "11:00", 30, "残る"),
    ]);
    const settings = { ...SETTINGS, excludeKeywords: ["  ", "LUNCH"] };
    const o = await run([src], { settings });
    expect(o.summary).toMatchObject({ inserted: 1, filtered: 2 });
    expect(o.text).toContain("11:00 残る");
    const o2 = await run([src], { settings: { ...settings, skipDeclined: false } });
    expect(o2.summary).toMatchObject({ inserted: 2, filtered: 1 });
  });

  it("scopes records to this note: a recurring instance on another day is new, not changed", async () => {
    const other: InsertRecord = {
      uid: "series",
      startIso: new Date(2026, 10, 3, 9, 0).toISOString(),
      title: "定例",
      notePath: "Daily/2026-11-03.md",
      date: "2026-11-03",
      insertedAt: NOW.toISOString(),
    };
    const o = await run([fake([ev("series", "09:00", 30, "定例")])], { records: [other] });
    expect(o.summary).toMatchObject({ inserted: 1, changed: 0 });
  });

  it("settings errors leave the note unchanged and do not fetch", async () => {
    const src = fake([ev("u1", "09:00", 30, "定例")]);
    const dup = await run([src], {
      settings: { ...SETTINGS, sections: [{ start: "05:00", heading: "朝" }, { start: "5:00", heading: "早朝" }] },
    });
    expect(dup.status).toBe("settingsError");
    expect(dup.text).toBeNull();
    expect(src.calls).toHaveLength(0);
    const fb = await run([src], { settings: { ...SETTINGS, fallbackHeading: "Calendar" } });
    expect(fb.status).toBe("settingsError");
    expect(buildNoticeMessage(fb, "ja", "Calendar")).toMatch(/^設定エラー: /);
  });

  it("no sources → noSources, note unchanged", async () => {
    const o = await run([]);
    expect(o.status).toBe("noSources");
    expect(o.text).toBeNull();
  });

  it("applies title options from settings (prefix, tentative, estimate format)", async () => {
    const o = await run([fake([ev("t", "09:00", 90, "仮", { status: "tentative" })], "Work")], {
      settings: { ...SETTINGS, prefixWithCalendarLabel: true, tentativePrefix: "(仮) ", estimateFormat: "h" },
    });
    expect(o.text).toContain("- [ ] 09:00 (仮) [Work] 仮 (1.5h)");
  });
});

describe("helpers", () => {
  it("headingLabel strips #'s", () => {
    expect(headingLabel("## Calendar")).toBe("Calendar");
    expect(headingLabel("  ### 予定 ##")).toBe("予定");
  });

  it("filterReason", () => {
    expect(filterReason(ev("x", "09:00", 30, "a", { status: "cancelled" }), SETTINGS)).toBe("cancelled");
    expect(filterReason(ev("x", "09:00", 30, "a"), SETTINGS)).toBeNull();
  });

  it("validateImportSettings", () => {
    expect(validateImportSettings(SETTINGS)).toBeNull();
    expect(validateImportSettings({ ...SETTINGS, dayBoundary: "25:00" })).not.toBeNull();
    expect(validateImportSettings({ ...SETTINGS, fallbackHeading: "#Calendar" })).not.toBeNull();
  });
});
