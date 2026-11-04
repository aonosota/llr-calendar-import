import { describe, expect, it } from "vitest";
import { logicalDate, minutesFromBoundary, windowForDate, formatLocalTime } from "./time";

describe("time", () => {
  it("logicalDate shifts before boundary", () => {
    expect(logicalDate(new Date(2026, 10, 5, 1, 30), "04:00")).toBe("2026-11-04");
    expect(logicalDate(new Date(2026, 10, 5, 4, 0), "04:00")).toBe("2026-11-05");
    expect(logicalDate(new Date(2026, 10, 1, 0, 0), "00:00")).toBe("2026-11-01");
  });
  it("windowForDate spans boundary to boundary", () => {
    const w = windowForDate("2026-11-04", "04:00");
    expect(w.start).toEqual(new Date(2026, 10, 4, 4, 0));
    expect(w.end).toEqual(new Date(2026, 10, 5, 4, 0));
    expect(formatLocalTime(w.end)).toBe("04:00");
  });
  it("minutesFromBoundary orders after-midnight after evening", () => {
    expect(minutesFromBoundary("01:00", "04:00")).toBeGreaterThan(minutesFromBoundary("23:00", "04:00"));
    expect(minutesFromBoundary("04:00", "04:00")).toBe(0);
  });
});
