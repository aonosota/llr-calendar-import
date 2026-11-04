import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type { LocalDate } from "../types";
import type { Translate } from "../i18n";

/** Yes/no confirmation. Resolves false when closed without confirming. */
export function confirmModal(app: App, t: Translate, title: string, body: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const modal = new (class extends Modal {
      onOpen(): void {
        this.titleEl.setText(title);
        this.contentEl.createEl("p", { text: body });
        new Setting(this.contentEl)
          .addButton((b) =>
            b
              .setButtonText(okLabel)
              .setCta()
              .onClick(() => {
                result = true;
                this.close();
              }),
          )
          .addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()));
      }
      onClose(): void {
        this.contentEl.empty();
        resolve(result);
      }
    })(app);
    modal.open();
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date picker (type=date). Resolves the chosen date or null when cancelled. */
export function pickDateModal(app: App, t: Translate, initial: LocalDate): Promise<LocalDate | null> {
  return new Promise((resolve) => {
    let result: LocalDate | null = null;
    const modal = new (class extends Modal {
      onOpen(): void {
        this.titleEl.setText(t("modal.date.title"));
        const input = this.contentEl.createEl("input", { type: "date" });
        input.value = initial;
        const submit = () => {
          if (!DATE_RE.test(input.value)) return;
          result = input.value;
          this.close();
        };
        input.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            submit();
          }
        });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText(t("modal.date.submit")).setCta().onClick(submit))
          .addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()));
        window.setTimeout(() => input.focus(), 0);
      }
      onClose(): void {
        this.contentEl.empty();
        resolve(result);
      }
    })(app);
    modal.open();
  });
}
