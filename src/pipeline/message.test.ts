import { describe, expect, it } from "vitest";
import type { ImportOutcome } from "./index";
import { buildNoticeMessage } from "./message";

function ok(summary: Partial<ImportOutcome["summary"]>): ImportOutcome {
  return {
    status: "ok",
    text: "x",
    records: [],
    summary: { inserted: 0, perHeading: {}, fallback: 0, duplicates: 0, changed: 0, filtered: 0, failedSources: [], ...summary },
  };
}

describe("buildNoticeMessage", () => {
  const full = ok({
    inserted: 7,
    perHeading: { 朝: 2, 午後: 3, Calendar: 2 },
    duplicates: 1,
    changed: 1,
    fallback: 2,
    failedSources: ["Work"],
  });

  it("JA full summary", () => {
    expect(buildNoticeMessage(full, "ja", "Calendar")).toBe(
      "7 件を挿入(朝 2、午後 3)、1 件は挿入済みのためスキップ、1 件は変更のため追記、2 件はセクションが見つからず Calendar に追加\n取得失敗: Work",
    );
  });

  it("EN full summary", () => {
    expect(buildNoticeMessage(full, "en", "Calendar")).toBe(
      "Inserted 7 event(s) (朝 2, 午後 3), skipped 1 already inserted, appended 1 changed, added 2 under Calendar (section not found)\nFetch failed: Work",
    );
  });

  it("nothing new", () => {
    expect(buildNoticeMessage(ok({ duplicates: 3, filtered: 2 }), "ja", "Calendar")).toBe(
      "新しい予定はありません、3 件は挿入済みのためスキップ、2 件はフィルタで除外",
    );
  });

  it("status messages", () => {
    const base = ok({});
    expect(buildNoticeMessage({ ...base, status: "noSources" }, "en", "Calendar")).toMatch(/No enabled calendar/);
    expect(buildNoticeMessage({ ...base, status: "settingsError", errorMessage: "bad" }, "en", "Calendar")).toBe(
      "Settings error: bad. The note was not changed.",
    );
  });
});
