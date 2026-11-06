import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { CalendarConfig, EstimateFormat, HeadingMatchMode, PluginSettings } from "../types";
import { isValidHHmm } from "../time";
import type { Translate } from "../i18n";
import { isValidFallbackHeading, newCalendarId, parseKeywords, secretIdFor, validateSections } from "./data";
import { resolveCalendarUrlInfo, secretStore } from "./secrets";
import type { SecretStore } from "./secrets";
import { applyUrlInput, changeStorage, effectiveStorage } from "./urlStorage";
import type { SecretWrite, UrlStorage } from "./urlStorage";
import { convertLlrSections, sectionBeforeBoundary } from "./llrSections";
import { readLlrSectionDefinitions } from "./llrImport";
import { confirmModal } from "./modals";

export interface SettingsHost extends Plugin {
  settings: PluginSettings;
  t: Translate;
  saveSettings(): Promise<void>;
}

function errorEl(parent: HTMLElement): HTMLElement {
  return parent.createDiv({ cls: "llr-cal-error" });
}

export class LlrCalendarSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: SettingsHost,
  ) {
    super(app, host);
  }

  private get s(): PluginSettings {
    return this.host.settings;
  }

  private save(): void {
    void this.host.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.renderCalendars(containerEl);
    this.renderSections(containerEl);
    this.renderOptions(containerEl);
  }

  // ---- calendars -------------------------------------------------------

  private renderCalendars(root: HTMLElement): void {
    const { t } = this.host;
    const store = secretStore(this.app);
    new Setting(root).setName(t("set.calendars")).setHeading().setDesc(t("set.calendars.desc"));
    root.createEl("p", {
      text: store ? t("set.calendars.secretNote") : t("set.calendars.syncWarn"),
      cls: "setting-item-description",
    });
    root.createEl("p", { text: t("set.calendars.security"), cls: "setting-item-description" });

    this.s.calendars.forEach((cal, i) => this.renderCalendar(root, cal, i));

    new Setting(root).addButton((b) =>
      b.setButtonText(t("set.calendars.add")).onClick(() => {
        this.s.calendars.push({ id: newCalendarId(), url: "", enabled: true, label: "" });
        this.save();
        this.display();
      }),
    );
  }

  private renderCalendar(root: HTMLElement, cal: CalendarConfig, index: number): void {
    const { t } = this.host;
    const store = secretStore(this.app);
    const box = root.createDiv({ cls: "llr-cal-calendar" });

    new Setting(box)
      .setName(`${t("set.cal.label")} ${index + 1}`)
      .addText((text) =>
        text.setValue(cal.label ?? "").onChange((v) => {
          cal.label = v.trim();
          this.save();
        }),
      )
      .addToggle((tg) =>
        tg
          .setTooltip(t("set.cal.enabled"))
          .setValue(cal.enabled)
          .onChange((v) => {
            cal.enabled = v;
            this.save();
          }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip(t("set.cal.remove"))
          .onClick(() => {
            if (cal.secretId && store) {
              try {
                store.setSecret(cal.secretId, "");
              } catch {
                // nothing else to clean up
              }
            }
            this.s.calendars.splice(index, 1);
            this.save();
            this.display();
          }),
      );

    const storage = effectiveStorage(cal, store !== null);
    const info = resolveCalendarUrlInfo(this.app, cal);
    const storageSetting = new Setting(box).setName(t("set.cal.storage"));
    if (!store) storageSetting.setDesc(t("set.cal.storage.noSecret"));
    storageSetting.addDropdown((d) => {
      d.addOption("device", t("set.cal.storage.device")).addOption("synced", t("set.cal.storage.synced"));
      d.setValue(storage);
      if (!store) d.selectEl.options[0]?.setAttribute("disabled", "true");
      d.onChange((v) => this.switchStorage(index, v as UrlStorage, store));
    });

    new Setting(box)
      .setName(t("set.cal.url"))
      .setDesc(info.missing === null ? t("set.cal.status.saved") : t("set.cal.status.unsaved"))
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.inputEl.spellcheck = false;
        text.setPlaceholder(info.missing === null ? t("set.cal.urlStored") : "https://…/basic.ics");
        text.onChange((v) => {
          const url = v.trim();
          // Empty input keeps a stored URL (the field is shown empty).
          if (url === "" && info.missing === null) return;
          this.writeUrl(cal, url, store);
        });
      });
    if (this.pendingEnter.has(cal.id) && info.missing !== null) {
      errorEl(box).setText(t("set.cal.enterUrl"));
    }
  }

  /** Calendars that were just switched to "synced" without a URL on this device. */
  private readonly pendingEnter = new Set<string>();

  private runWrite(write: SecretWrite | null, store: SecretStore | null): boolean {
    if (!write) return true;
    if (!store) return false;
    try {
      store.setSecret(write.id, write.value);
      return true;
    } catch {
      return false;
    }
  }

  private writeUrl(cal: CalendarConfig, url: string, store: SecretStore | null): void {
    const r = applyUrlInput(cal, url, store !== null, secretIdFor);
    if (!this.runWrite(r.write, store)) {
      // SecretStorage failed: keep the URL in data.json rather than lose it.
      Object.assign(cal, { urlStorage: "synced" as const, url });
      delete cal.secretId;
    } else {
      Object.assign(cal, r.cfg);
    }
    this.pendingEnter.delete(cal.id);
    this.save();
  }

  private switchStorage(index: number, to: UrlStorage, store: SecretStore | null): void {
    const cal = this.s.calendars[index];
    if (!cal) return;
    const change = changeStorage(cal, to, store ? (id) => store.getSecret(id) : null, secretIdFor);
    if (!this.runWrite(change.write, store)) {
      this.display();
      return;
    }
    this.s.calendars[index] = change.cfg;
    if (change.needsInput) this.pendingEnter.add(cal.id);
    else this.pendingEnter.delete(cal.id);
    this.save();
    this.display();
  }

  // ---- sections --------------------------------------------------------

  private renderSections(root: HTMLElement): void {
    const { t } = this.host;
    new Setting(root).setName(t("set.sections")).setHeading().setDesc(t("set.sections.desc"));
    root.createEl("p", { text: t("set.sections.hint"), cls: "setting-item-description" });

    this.renderLlrImport(root);

    const list = root.createDiv();
    const errors = errorEl(root);
    const refreshErrors = () => {
      errors.empty();
      for (const msg of validateSections(this.s.sections, t)) errors.createDiv({ text: msg });
    };

    this.s.sections.forEach((sec, i) => {
      new Setting(list)
        .addText((text) =>
          text
            .setPlaceholder(t("set.sections.start"))
            .setValue(sec.start)
            .onChange((v) => {
              sec.start = v.trim();
              this.save();
              refreshErrors();
            }),
        )
        .addText((text) =>
          text
            .setPlaceholder(t("set.sections.heading"))
            .setValue(sec.heading)
            .onChange((v) => {
              sec.heading = v.trim();
              this.save();
              refreshErrors();
            }),
        )
        .addExtraButton((b) =>
          b.setIcon("trash").onClick(() => {
            this.s.sections.splice(i, 1);
            this.save();
            this.display();
          }),
        );
    });
    refreshErrors();

    new Setting(root).addButton((b) =>
      b.setButtonText(t("set.sections.add")).onClick(() => {
        this.s.sections.push({ start: "", heading: "" });
        this.save();
        this.display();
      }),
    );

    new Setting(root)
      .setName(t("set.headingMatch"))
      .setDesc(t("set.headingMatch.desc"))
      .addDropdown((d) =>
        d
          .addOption("exact", t("set.headingMatch.exact"))
          .addOption("partial", t("set.headingMatch.partial"))
          .setValue(this.s.headingMatch)
          .onChange((v) => {
            this.s.headingMatch = v as HeadingMatchMode;
            this.save();
          }),
      );
  }

  private renderLlrImport(root: HTMLElement): void {
    const { t } = this.host;
    new Setting(root)
      .setName(t("set.sections.llr"))
      .setDesc(t("set.sections.llr.desc"))
      .addButton((b) => b.setButtonText(t("set.sections.llr.button")).onClick(() => void this.importFromLlr()));
  }

  private async importFromLlr(): Promise<void> {
    const { t } = this.host;
    const raw = await readLlrSectionDefinitions(this.app);
    if (raw === null) {
      new Notice(t("notice.llrNotFound"));
      return;
    }
    const { sections, skipped } = convertLlrSections(raw);
    if (sections.length === 0) {
      new Notice(t("notice.llrEmpty"));
      return;
    }
    if (this.s.sections.length > 0) {
      const ok = await confirmModal(
        this.app,
        t,
        t("modal.llr.title"),
        t("modal.llr.body", { n: this.s.sections.length, m: sections.length }),
        t("modal.llr.ok"),
      );
      if (!ok) return;
    }
    this.s.sections = sections;
    this.save();
    this.display();
    const lines = [t("notice.llrImported", { n: sections.length })];
    if (skipped > 0) lines.push(t("notice.llrSkipped", { n: skipped }));
    const early = sectionBeforeBoundary(sections, this.s.dayBoundary);
    if (early !== null) lines.push(t("set.sections.llr.boundaryHint", { start: early, boundary: this.s.dayBoundary }));
    new Notice(lines.join("\n"), 8000);
  }

  // ---- other options ---------------------------------------------------

  /** Text setting saved only when `validate` returns null; shows the error inline. */
  private validatedText(
    root: HTMLElement,
    name: string,
    desc: string,
    value: string,
    validate: (v: string) => string | null,
    apply: (v: string) => void,
  ): void {
    const setting = new Setting(root).setName(name).setDesc(desc);
    const err = errorEl(setting.descEl);
    setting.addText((text) =>
      text.setValue(value).onChange((v) => {
        const msg = validate(v);
        err.setText(msg ?? "");
        if (msg === null) {
          apply(v);
          this.save();
        }
      }),
    );
  }

  private toggle(root: HTMLElement, name: string, desc: string | null, key: "prefixWithCalendarLabel" | "skipDeclined" | "includeAllDay" | "debugLog"): void {
    const setting = new Setting(root).setName(name);
    if (desc) setting.setDesc(desc);
    setting.addToggle((tg) =>
      tg.setValue(this.s[key]).onChange((v) => {
        this.s[key] = v;
        this.save();
      }),
    );
  }

  private plainText(root: HTMLElement, name: string, desc: string, key: "titlePrefix" | "tentativePrefix" | "myEmail"): void {
    new Setting(root)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text.setValue(this.s[key]).onChange((v) => {
          this.s[key] = key === "myEmail" ? v.trim() : v;
          this.save();
        }),
      );
  }

  private renderOptions(root: HTMLElement): void {
    const { t } = this.host;
    new Setting(root).setName(t("set.options")).setHeading();

    this.validatedText(
      root,
      t("set.dayBoundary"),
      t("set.dayBoundary.desc"),
      this.s.dayBoundary,
      (v) => (isValidHHmm(v) ? null : t("err.hhmm")),
      (v) => (this.s.dayBoundary = v.trim()),
    );
    this.validatedText(
      root,
      t("set.fallbackHeading"),
      t("set.fallbackHeading.desc"),
      this.s.fallbackHeading,
      (v) => (isValidFallbackHeading(v) ? null : t("err.fallback")),
      (v) => (this.s.fallbackHeading = v.trim()),
    );
    this.validatedText(
      root,
      t("set.defaultDuration"),
      t("set.defaultDuration.desc"),
      String(this.s.defaultDurationMinutes),
      (v) => (/^\d+$/.test(v.trim()) && Number(v) > 0 ? null : t("err.positiveInt")),
      (v) => (this.s.defaultDurationMinutes = Number(v.trim())),
    );

    new Setting(root).setName(t("set.estimateFormat")).addDropdown((d) =>
      d
        .addOption("m", t("set.estimateFormat.m"))
        .addOption("h", t("set.estimateFormat.h"))
        .setValue(this.s.estimateFormat)
        .onChange((v) => {
          this.s.estimateFormat = v as EstimateFormat;
          this.save();
        }),
    );

    this.plainText(root, t("set.titlePrefix"), t("set.titlePrefix.desc"), "titlePrefix");
    this.toggle(root, t("set.prefixLabel"), t("set.prefixLabel.desc"), "prefixWithCalendarLabel");

    new Setting(root)
      .setName(t("set.excludeKeywords"))
      .setDesc(t("set.excludeKeywords.desc"))
      .addTextArea((ta) =>
        ta.setValue(this.s.excludeKeywords.join("\n")).onChange((v) => {
          this.s.excludeKeywords = parseKeywords(v);
          this.save();
        }),
      );

    this.plainText(root, t("set.myEmail"), t("set.myEmail.desc"), "myEmail");
    this.toggle(root, t("set.skipDeclined"), null, "skipDeclined");
    this.plainText(root, t("set.tentativePrefix"), t("set.tentativePrefix.desc"), "tentativePrefix");
    this.toggle(root, t("set.includeAllDay"), t("set.includeAllDay.desc"), "includeAllDay");
    this.toggle(root, t("set.debugLog"), t("set.debugLog.desc"), "debugLog");
  }
}
