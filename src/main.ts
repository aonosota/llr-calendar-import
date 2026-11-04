import { Plugin } from "obsidian";
import type { ImportHost } from "./ui/importer";
import type { InsertRecord, PluginSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { formatLocalDate, isValidHHmm, logicalDate } from "./time";
import { createTranslator } from "./i18n";
import type { Lang, Translate } from "./i18n";
import { loadPluginData } from "./ui/data";
import type { PluginData } from "./ui/data";
import { Importer } from "./ui/importer";
import { pickDateModal } from "./ui/modals";
import { LlrCalendarSettingTab } from "./ui/settings";

export default class LlrCalendarImportPlugin extends Plugin implements ImportHost {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  records: InsertRecord[] = [];
  lang: Lang = "en";
  t!: Translate;
  private importer!: Importer;

  async onload(): Promise<void> {
    const { lang, t } = createTranslator();
    this.lang = lang;
    this.t = t;

    const data = loadPluginData(await this.loadData(), formatLocalDate(new Date()));
    this.settings = data.settings;
    this.records = data.records;

    this.importer = new Importer(this);

    this.addCommand({
      id: "insert-today",
      name: t("cmd.today"),
      callback: () => void this.importer.run(this.logicalToday()),
    });
    this.addCommand({
      id: "insert-date",
      name: t("cmd.date"),
      callback: async () => {
        const date = await pickDateModal(this.app, t, this.logicalToday());
        if (date) await this.importer.run(date);
      },
    });

    this.addSettingTab(new LlrCalendarSettingTab(this.app, this));
  }

  private logicalToday(): string {
    const b = isValidHHmm(this.settings.dayBoundary) ? this.settings.dayBoundary : DEFAULT_SETTINGS.dayBoundary;
    return logicalDate(new Date(), b);
  }

  private async persist(): Promise<void> {
    const data: PluginData = { settings: this.settings, records: this.records };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  async saveRecords(added: InsertRecord[]): Promise<void> {
    this.records = [...this.records, ...added];
    await this.persist();
  }
}
