import { describe, expect, it } from "vitest";
import { resolveLang, translator } from "./dict";

describe("i18n", () => {
  it("resolveLang", () => {
    expect(resolveLang("ja")).toBe("ja");
    expect(resolveLang("ja-JP")).toBe("ja");
    expect(resolveLang("en")).toBe("en");
    expect(resolveLang("zh")).toBe("en");
    expect(resolveLang(null)).toBe("en");
  });

  it("translator fills placeholders", () => {
    expect(translator("ja")("notice.failed", { name: "Work" })).toBe("取得失敗: Work");
    expect(translator("en")("unnamedCalendar", { n: 2 })).toBe("Calendar 2");
  });
});
