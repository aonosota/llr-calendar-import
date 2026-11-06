import { Notice, requestUrl } from "obsidian";
import type { App, TFile } from "obsidian";
import type { CalendarSource, InsertRecord, LocalDate, PluginSettings, TextFetcher } from "../types";
import { SourceError } from "../types";
import { windowForDate } from "../time";
import { createIcsSource, maskUrl } from "../source/ics";
import { buildNoticeMessage, fetchAllEvents, headingLabel, planImport, validateImportSettings } from "../pipeline";
import type { ImportOutcome } from "../pipeline";
import type { Lang, Translate } from "../i18n";
import { createDailyNote, dailyNotePath, getDailyNoteConfig } from "./dailyNote";
import { confirmModal } from "./modals";
import { resolveCalendarUrlInfo } from "./secrets";

/** What the importer needs from the plugin. */
export interface ImportHost {
  app: App;
  lang: Lang;
  t: Translate;
  settings: PluginSettings;
  records: InsertRecord[];
  saveRecords(added: InsertRecord[]): Promise<void>;
}

const LOG_PREFIX = "[llr-calendar-import]";

export const requestUrlFetcher: TextFetcher = async (url) => {
  const res = await requestUrl({ url, method: "GET", throw: false });
  return { status: res.status, text: res.text };
};

function notice(message: string): void {
  new Notice(message, 8000);
}

export class Importer {
  private running = false;

  constructor(private readonly host: ImportHost) {}

  private debug(message: string): void {
    if (this.host.settings.debugLog) console.debug(LOG_PREFIX, message);
  }

  /** Names (as the pipeline reports them) of calendars whose URL is device-stored but absent here. */
  private missingOnDevice = new Set<string>();

  private buildSources(): CalendarSource[] {
    const sources: CalendarSource[] = [];
    this.missingOnDevice = new Set();
    let position = 0;
    for (const cfg of this.host.settings.calendars) {
      if (!cfg.enabled) continue;
      position++;
      const { url, missing } = resolveCalendarUrlInfo(this.host.app, cfg);
      if (url === "") {
        // Same naming rule as fetchAllEvents (label, else "Calendar <n>").
        if (missing === "device") {
          this.missingOnDevice.add(cfg.label?.trim() ? cfg.label.trim() : this.host.t("unnamedCalendar", { n: position }));
        }
        this.debug(`calendar "${cfg.label ?? cfg.id}" has no URL`);
        sources.push({
          id: cfg.id,
          label: cfg.label,
          fetchEvents: () => Promise.reject(new SourceError("Calendar URL is not set", "fetch", cfg.label)),
        });
        continue;
      }
      this.debug(`calendar "${cfg.label ?? cfg.id}" → ${maskUrl(url)}`);
      // A transient copy carrying the resolved URL; never persisted.
      sources.push(createIcsSource({ ...cfg, url }, requestUrlFetcher));
    }
    return sources;
  }

  /** Replaces the generic "fetch failed" line of device-missing calendars with a specific one. Names only, no URLs. */
  private withDeviceHints(message: string): string {
    const { t } = this.host;
    return message
      .split("\n")
      .map((line) => {
        for (const name of this.missingOnDevice) {
          if (line === t("notice.failed", { name })) return t("notice.urlMissingDevice", { name });
        }
        return line;
      })
      .join("\n");
  }

  /** Import events of `date` into its daily note. Concurrent calls are ignored. */
  async run(date: LocalDate): Promise<void> {
    const { t } = this.host;
    if (this.running) {
      notice(t("notice.busy"));
      return;
    }
    this.running = true;
    try {
      await this.runUnguarded(date);
    } catch (e) {
      // Errors here come from the vault or UI, not from sources; still log only the name.
      console.error(LOG_PREFIX, "import failed:", e instanceof Error ? e.name : typeof e);
      notice(t("notice.unexpected"));
    } finally {
      this.running = false;
    }
  }

  private async runUnguarded(date: LocalDate): Promise<void> {
    const { app, t, lang } = this.host;
    const settings = this.host.settings;
    const fallbackLabel = headingLabel(settings.fallbackHeading);
    const show = (o: ImportOutcome) => notice(this.withDeviceHints(buildNoticeMessage(o, lang, fallbackLabel)));

    const invalid = validateImportSettings(settings);
    if (invalid !== null) {
      notice(t("notice.settingsError", { message: invalid }));
      return;
    }
    const sources = this.buildSources();
    if (sources.length === 0) {
      notice(t("notice.noSources"));
      return;
    }

    const cfg = getDailyNoteConfig(app);
    const path = dailyNotePath(cfg, date);
    let file: TFile | null = app.vault.getFileByPath(path);
    if (!file) {
      const ok = await confirmModal(
        app,
        t,
        t("modal.create.title"),
        t("modal.create.body", { path }),
        t("modal.create.ok"),
      );
      if (!ok) return;
    }

    // Fetch before touching the note: vault.process callbacks must be synchronous.
    const fetched = await fetchAllEvents(sources, {
      window: windowForDate(date, settings.dayBoundary),
      myEmail: settings.myEmail.trim().toLowerCase(),
      unnamedSourceName: (n) => t("unnamedCalendar", { n }),
      log: (m) => this.debug(m),
    });
    if (fetched.failedSources.length >= fetched.sourceCount) {
      show(planImport({ date, settings, fetched, noteText: "", notePath: path, records: [], now: new Date() }));
      return;
    }

    if (!file) {
      file = app.vault.getFileByPath(path) ?? (await createDailyNote(app, cfg, path, date));
    }

    let outcome: ImportOutcome | null = null;
    const records = this.host.records;
    await app.vault.process(file, (data) => {
      outcome = planImport({ date, settings, fetched, noteText: data, notePath: path, records, now: new Date() });
      return outcome.text ?? data;
    });
    const result = outcome as ImportOutcome | null;
    if (!result) return;
    this.debug(`result: ${JSON.stringify(result.summary)}`);
    if (result.text !== null && result.records.length > 0) await this.host.saveRecords(result.records);
    show(result);
  }
}
