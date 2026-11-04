import type {
  CalendarConfig,
  CalendarSource,
  FetchContext,
  NormalizedEvent,
  TextFetcher,
} from "../../types";
import { SourceError } from "../../types";
import { parseIcsEvents } from "./parse";

export { parseIcsEvents, isInWindow, MAX_OCCURRENCES_PER_SERIES } from "./parse";
export type { ParseOptions } from "./parse";

/** "webcal://…" → "https://…" (scheme is case-insensitive). Other URLs unchanged. */
export function normalizeIcsUrl(url: string): string {
  const trimmed = url.trim();
  return /^webcals?:\/\//i.test(trimmed) ? trimmed.replace(/^webcals?:\/\//i, "https://") : trimmed;
}

/**
 * Masks a calendar URL for debug logs: keeps scheme and host only, drops
 * userinfo, path, query and fragment. e.g. "https://calendar.google.com/…(masked)".
 */
export function maskUrl(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i.exec(url.trim());
  if (!m) return "(masked)";
  const authority = m[2] ?? "";
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return `${m[1] ?? ""}${host}/…(masked)`;
}

/** CalendarSource backed by an ICS URL. Errors never contain the URL. */
export function createIcsSource(config: CalendarConfig, fetcher: TextFetcher): CalendarSource {
  const name = config.label ?? config.id;
  return {
    id: config.id,
    label: config.label,
    async fetchEvents(ctx: FetchContext): Promise<NormalizedEvent[]> {
      let res: { status: number; text: string };
      try {
        res = await fetcher(normalizeIcsUrl(config.url));
      } catch {
        // The underlying error may embed the URL, so it is deliberately dropped.
        throw new SourceError(`Failed to fetch calendar "${name}"`, "fetch", config.label);
      }
      if (res.status >= 400) {
        throw new SourceError(
          `Calendar "${name}" returned HTTP ${res.status}`,
          "http",
          config.label,
        );
      }
      return parseIcsEvents(res.text, ctx, { sourceLabel: config.label });
    },
  };
}
