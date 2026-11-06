import type { App } from "obsidian";

/** Narrow views of the parts of Obsidian / the LLR plugin we touch. */
interface PluginsHost {
  plugins?: { getPlugin?: (id: string) => unknown };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * LLR's raw `sectionDefinitions`, or null when LLR settings cannot be found.
 * Order: (a) the running LLR plugin's in-memory settings (works on mobile),
 * (b) LLR's data.json read through the vault adapter.
 */
export async function readLlrSectionDefinitions(app: App): Promise<unknown> {
  try {
    const plugin = (app as unknown as PluginsHost).plugins?.getPlugin?.("llr");
    if (isObject(plugin) && isObject(plugin.settings) && "sectionDefinitions" in plugin.settings) {
      return plugin.settings.sectionDefinitions;
    }
  } catch {
    // fall through to data.json
  }
  try {
    const text = await app.vault.adapter.read(`${app.vault.configDir}/plugins/llr/data.json`);
    const data: unknown = JSON.parse(text);
    if (isObject(data) && "sectionDefinitions" in data) return data.sectionDefinitions;
  } catch {
    // not found / unreadable
  }
  return null;
}
