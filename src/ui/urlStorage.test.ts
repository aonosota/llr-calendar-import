import { describe, expect, it } from "vitest";
import type { CalendarConfig } from "../types";
import { secretIdFor } from "./data";
import { applyUrlInput, changeStorage, effectiveStorage, resolveUrlInfo } from "./urlStorage";

const cal = (o: Partial<CalendarConfig> = {}): CalendarConfig => ({ id: "c1", url: "", enabled: true, ...o });
const store = (m: Record<string, string>) => (id: string) => m[id] ?? null;

describe("effectiveStorage", () => {
  it("defaults by secretId and falls back without SecretStorage", () => {
    expect(effectiveStorage(cal({ secretId: "s" }), true)).toBe("device");
    expect(effectiveStorage(cal(), true)).toBe("synced");
    expect(effectiveStorage(cal({ urlStorage: "synced", secretId: "s" }), true)).toBe("synced");
    expect(effectiveStorage(cal({ urlStorage: "device", secretId: "s" }), false)).toBe("synced");
  });
});

describe("resolveUrlInfo", () => {
  it("synced uses cfg.url", () => {
    expect(resolveUrlInfo(cal({ urlStorage: "synced", url: " https://x " }), store({}))).toEqual({ url: "https://x", missing: null });
    expect(resolveUrlInfo(cal({ urlStorage: "synced" }), store({}))).toEqual({ url: "", missing: "unset" });
  });
  it("device uses the secret and reports missing on this device", () => {
    const c = cal({ secretId: "s" });
    expect(resolveUrlInfo(c, store({ s: "https://y" }))).toEqual({ url: "https://y", missing: null });
    expect(resolveUrlInfo(c, store({}))).toEqual({ url: "", missing: "device" });
    expect(resolveUrlInfo(c, store({ s: "" }))).toEqual({ url: "", missing: "device" });
    expect(resolveUrlInfo(c, () => { throw new Error("x"); })).toEqual({ url: "", missing: "device" });
  });
  it("without SecretStorage a device calendar reads cfg.url", () => {
    expect(resolveUrlInfo(cal({ secretId: "s", url: "" }), null)).toEqual({ url: "", missing: "unset" });
  });
});

describe("changeStorage", () => {
  it("device → synced copies the secret and blanks it", () => {
    const c = cal({ secretId: "s" });
    const r = changeStorage(c, "synced", store({ s: "https://y" }), secretIdFor);
    expect(r.cfg).toEqual({ id: "c1", url: "https://y", enabled: true, urlStorage: "synced" });
    expect(r.cfg.secretId).toBeUndefined();
    expect(r.write).toEqual({ id: "s", value: "" });
    expect(r.needsInput).toBe(false);
    expect(c.secretId).toBe("s"); // input untouched
  });
  it("device → synced with the secret missing asks for input", () => {
    const r = changeStorage(cal({ secretId: "s" }), "synced", store({}), secretIdFor);
    expect(r.cfg.url).toBe("");
    expect(r.cfg.urlStorage).toBe("synced");
    expect(r.needsInput).toBe(true);
  });
  it("synced → device moves url into the secret", () => {
    const r = changeStorage(cal({ url: " https://z " }), "device", store({}), secretIdFor);
    expect(r.cfg).toEqual({ id: "c1", url: "", enabled: true, urlStorage: "device", secretId: "llr-cal-c1" });
    expect(r.write).toEqual({ id: "llr-cal-c1", value: "https://z" });
  });
  it("device is refused without SecretStorage", () => {
    const r = changeStorage(cal({ url: "https://z" }), "device", null, secretIdFor);
    expect(r.cfg.url).toBe("https://z");
    expect(r.write).toBeNull();
  });
});

describe("applyUrlInput", () => {
  it("writes to the selected storage", () => {
    expect(applyUrlInput(cal({ urlStorage: "synced" }), " u ", true, secretIdFor)).toEqual({ cfg: cal({ urlStorage: "synced", url: "u" }), write: null });
    const d = applyUrlInput(cal({ secretId: "s" }), "u", true, secretIdFor);
    expect(d.write).toEqual({ id: "s", value: "u" });
    expect(d.cfg.url).toBe("");
    expect(applyUrlInput(cal({ secretId: "s" }), "u", false, secretIdFor).cfg.url).toBe("u");
  });
});
