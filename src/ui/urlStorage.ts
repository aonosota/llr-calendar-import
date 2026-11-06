import type { CalendarConfig } from "../types";

/**
 * Pure URL-storage logic (no `obsidian` import). The SecretStorage side is
 * injected as `SecretReader` so it can be tested with a fake store.
 */

export type UrlStorage = "device" | "synced";

/** Why a URL is empty: not entered at all, or device-stored but absent on this device. */
export type UrlMissing = null | "device" | "unset";

export interface UrlInfo {
  url: string;
  missing: UrlMissing;
}

export type SecretReader = (id: string) => string | null;

/** A secret write the caller must perform on the SecretStorage. */
export interface SecretWrite {
  id: string;
  value: string;
}

export interface StorageChange {
  cfg: CalendarConfig;
  /** SecretStorage write to perform (null = none). */
  write: SecretWrite | null;
  /** True when switching to "synced" but this device has no URL to carry over. */
  needsInput: boolean;
}

/** `cfg.urlStorage ?? (cfg.secretId ? "device" : "synced")`; "device" falls back to "synced" without SecretStorage. */
export function effectiveStorage(cfg: CalendarConfig, secretAvailable: boolean): UrlStorage {
  const chosen: UrlStorage = cfg.urlStorage ?? (cfg.secretId ? "device" : "synced");
  return chosen === "device" && !secretAvailable ? "synced" : chosen;
}

/** The URL for the current storage. `read` is null when SecretStorage is unavailable. Never log the result. */
export function resolveUrlInfo(cfg: CalendarConfig, read: SecretReader | null): UrlInfo {
  if (effectiveStorage(cfg, read !== null) === "synced") {
    const url = cfg.url.trim();
    return { url, missing: url === "" ? "unset" : null };
  }
  let secret = "";
  if (read && cfg.secretId) {
    try {
      secret = (read(cfg.secretId) ?? "").trim();
    } catch {
      secret = "";
    }
  }
  return { url: secret, missing: secret === "" ? "device" : null };
}

/**
 * Switch a calendar's storage. Returns the new config (input untouched) and the
 * SecretStorage write to perform.
 *  - device → synced: carry the device secret into `url`, blank the secret, clear secretId.
 *  - synced → device: move `url` into the secret.
 */
export function changeStorage(
  cfg: CalendarConfig,
  to: UrlStorage,
  read: SecretReader | null,
  makeSecretId: (calendarId: string) => string,
): StorageChange {
  const from = effectiveStorage(cfg, read !== null);
  if (to === "device" && read === null) return { cfg: { ...cfg }, write: null, needsInput: false };
  if (from === to) return { cfg: { ...cfg, urlStorage: to }, write: null, needsInput: false };

  if (to === "synced") {
    const next: CalendarConfig = { ...cfg, urlStorage: "synced", url: "" };
    delete next.secretId;
    const info = resolveUrlInfo(cfg, read);
    next.url = info.url;
    const write = cfg.secretId ? { id: cfg.secretId, value: "" } : null;
    return { cfg: next, write, needsInput: info.url === "" };
  }

  const id = cfg.secretId ?? makeSecretId(cfg.id);
  return {
    cfg: { ...cfg, urlStorage: "device", secretId: id, url: "" },
    write: { id, value: cfg.url.trim() },
    needsInput: false,
  };
}

/** Write an entered URL to the currently effective storage. */
export function applyUrlInput(
  cfg: CalendarConfig,
  input: string,
  secretAvailable: boolean,
  makeSecretId: (calendarId: string) => string,
): { cfg: CalendarConfig; write: SecretWrite | null } {
  const url = input.trim();
  if (effectiveStorage(cfg, secretAvailable) === "synced") {
    return { cfg: { ...cfg, url }, write: null };
  }
  const id = cfg.secretId ?? makeSecretId(cfg.id);
  return { cfg: { ...cfg, urlStorage: "device", secretId: id, url: "" }, write: { id, value: url } };
}
