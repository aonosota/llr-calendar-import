import { describe, expect, it } from "vitest";
import { readLeadingTime, readTaskLine } from "./lineTime";

describe("readLeadingTime", () => {
  it("recognizes task lines in any state", () => {
    expect(readLeadingTime("- [ ] 09:00 定例 (30m)")).toBe("09:00");
    expect(readLeadingTime("  * [x] 9:05 a")).toBe("09:05");
    expect(readLeadingTime("- [/] 13:00 x 13:02 - (30m)")).toBe("13:00");
  });
  it("rejects non-task or invalid lines", () => {
    expect(readLeadingTime("- 09:00 memo")).toBeNull();
    expect(readLeadingTime("+ [ ] 09:00 x")).toBeNull();
    expect(readLeadingTime("- [ ] 25:00 x")).toBeNull();
    expect(readLeadingTime("- [ ] task 09:00")).toBeNull();
  });
  it("readTaskLine returns text after the time", () => {
    expect(readTaskLine("- [x] 09:00 定例 09:02 - 09:30 (30m > 28m)")).toEqual({
      time: "09:00",
      text: "定例 09:02 - 09:30 (30m > 28m)",
    });
    expect(readTaskLine("- [ ] 終日")).toEqual({ time: null, text: "終日" });
  });
});
