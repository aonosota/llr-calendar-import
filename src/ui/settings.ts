import { PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { CalendarConfig, EstimateFormat, HeadingMatchMode, PluginSettings } from "../types";
import { isValidHHmm } from "../time";
import type { Translate } from "../i18n";
import { isValidFallbackHeading, newCalendarId, parseKeywords, secretIdFor, validateSections } from "./data";
import { secretStore } from "./secrets";

export interface SettingsHost extends Plugin {
  settings: PluginSettings;
  t: Translate;
  saveSettings(): Promise<void>;
}

function errorEl(parent: HTMLElement): HTMLElement {
  const el = parent.createDiv({ cls: "llr-cal-error" });
  el.style.color = "var(--text-error)";
  return el;
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

    const hasStored = Boolean(cal.secretId && store?.getSecret(cal.secretId));
    new Setting(box).setName(t("set.cal.url")).addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      if (store) {
        text.setPlaceholder(hasStored ? t("set.cal.urlStored") : "https://…/basic.ics");
        if (cal.url) text.setValue(cal.url);
      } else {
        text.setPlaceholder("https://…/basic.ics").setValue(cal.url);
      }
      text.onChange((v) => {
        const url = v.trim();
        if (store) {
          // Empty input keeps a stored secret (the field is shown empty).
          if (url === "" && hasStored) return;
          try {
            const id = secretIdFor(cal.id);
            store.setSecret(id, url);
            cal.secretId = id;
            cal.url = "";
          } catch {
            delete cal.secretId;
            cal.url = url;
          }
        } else {
          cal.url = url;
        }
        this.save();
      });
    });
  }

  // ---- sections --------------------------------------------------------

  private renderSections(root: HTMLElement): void {
    const { t } = this.host;
    new Setting(root).setName(t("set.sections")).setHeading().setDesc(t("set.sections.desc"));
    root.createEl("p", { text: t("set.sections.hint"), cls: "setting-item-description" });

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
