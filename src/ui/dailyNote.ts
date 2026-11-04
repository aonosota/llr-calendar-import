import type { App, TFile } from "obsidian";
import { moment, normalizePath } from "obsidian";
import type { LocalDate } from "../types";

/** Daily note settings resolved from Periodic Notes or core Daily Notes. */
export interface DailyNoteConfig {
  format: string;
  folder: string;
  template: string;
}

export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

interface RawDailyOptions {
  enabled?: unknown;
  format?: unknown;
  folder?: unknown;
  template?: unknown;
}

interface AppWithPlugins {
  plugins?: { getPlugin?: (id: string) => { settings?: { daily?: RawDailyOptions } } | null };
  internalPlugins?: {
    getPluginById?: (id: string) => { enabled?: boolean; instance?: { options?: RawDailyOptions } } | null;
  };
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toConfig(o: RawDailyOptions): DailyNoteConfig {
  return { format: s(o.format) || DEFAULT_DAILY_FORMAT, folder: s(o.folder), template: s(o.template) };
}

export function getDailyNoteConfig(app: App): DailyNoteConfig {
  const a = app as unknown as AppWithPlugins;
  try {
    const daily = a.plugins?.getPlugin?.("periodic-notes")?.settings?.daily;
    if (daily && daily.enabled === true) return toConfig(daily);
  } catch {
    // ignore and fall back
  }
  try {
    const core = a.internalPlugins?.getPluginById?.("daily-notes");
    const options = core?.instance?.options;
    if (options) return toConfig(options);
  } catch {
    // ignore and fall back
  }
  return { format: DEFAULT_DAILY_FORMAT, folder: "", template: "" };
}

// obsidian.d.ts types `moment` as the module namespace, which is not callable under
// esModuleInterop; at runtime it is the moment function.
type MomentFn = (input: string, format: string, strict: boolean) => { format(fmt: string): string };

function dateMoment(date: LocalDate) {
  return (moment as unknown as MomentFn)(date, "YYYY-MM-DD", true);
}

export function dailyNotePath(cfg: DailyNoteConfig, date: LocalDate): string {
  const name = dateMoment(date).format(cfg.format);
  return normalizePath(cfg.folder ? `${cfg.folder}/${name}.md` : `${name}.md`);
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split("/").filter((p) => p !== "" && p !== ".");
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}

async function readTemplate(app: App, cfg: DailyNoteConfig, date: LocalDate, title: string): Promise<string> {
  if (!cfg.template) return "";
  const base = normalizePath(cfg.template);
  const file = app.vault.getFileByPath(base) ?? app.vault.getFileByPath(`${base}.md`);
  if (!file) return "";
  const text = await app.vault.cachedRead(file);
  const formatted = dateMoment(date).format(cfg.format);
  return text.replace(/\{\{\s*date\s*\}\}/gi, formatted).replace(/\{\{\s*title\s*\}\}/gi, title);
}

/** Create the daily note (with template contents when configured) and missing folders. */
export async function createDailyNote(app: App, cfg: DailyNoteConfig, path: string, date: LocalDate): Promise<TFile> {
  const slash = path.lastIndexOf("/");
  if (slash > 0) await ensureFolder(app, path.slice(0, slash));
  const title = path.slice(slash + 1).replace(/\.md$/, "");
  const content = await readTemplate(app, cfg, date, title);
  return app.vault.create(path, content);
}
