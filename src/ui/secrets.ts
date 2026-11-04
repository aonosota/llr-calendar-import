import type { App } from "obsidian";
import type { CalendarConfig } from "../types";

/** SecretStorage subset (Obsidian >= 1.11.4). */
export interface SecretStore {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
}

/** app.secretStorage when this Obsidian version has it. */
export function secretStore(app: App): SecretStore | null {
  if (!("secretStorage" in app)) return null;
  const s = (app as { secretStorage?: unknown }).secretStorage;
  if (s && typeof s === "object" && "getSecret" in s && "setSecret" in s) return s as SecretStore;
  return null;
}

/** The calendar's URL (from SecretStorage or data.json), "" when not set. Never log it. */
export function resolveCalendarUrl(app: App, cfg: CalendarConfig): string {
  if (cfg.secretId) {
    const store = secretStore(app);
    if (store) {
      try {
        return store.getSecret(cfg.secretId) ?? "";
      } catch {
        return "";
      }
    }
  }
  return cfg.url;
}
