/**
 * Minimales i18n-System für das Wiktionary Sidebar Plugin.
 *
 * Unterstützte Sprachen: Englisch (Fallback), Deutsch.
 * Die aktive Sprache wird über `window.moment.locale()` ermittelt —
 * das entspricht der in Obsidian eingestellten UI-Sprache.
 *
 * Verwendung:
 *   t("placeholder")
 *   t("loading", { word: "Autonomie" })
 *   t("noLangEntry", { lang: "Español" })
 */

import en from "./i18n/en.json";
import de from "./i18n/de.json";

type Translations = typeof en;

const TRANSLATIONS: Record<string, Translations> = { en, de };

/** Gibt die aktive Obsidian-UI-Sprache zurück (z. B. "de", "en"). */
function getLocale(): string {
	// moment ist global in Obsidian verfügbar
	const locale = (window as any).moment?.locale?.() ?? "en";
	// Nur Sprachkürzel ohne Region (z. B. "de" aus "de-DE")
	return locale.split("-")[0].toLowerCase();
}

/**
 * Übersetzt einen Schlüssel in die aktive UI-Sprache.
 * Verschachtelte Schlüssel werden mit Punkt getrennt: "settings.title"
 * Template-Variablen werden mit {{key}} angegeben.
 */
export function t(key: string, vars?: Record<string, string>): string {
	const locale = getLocale();
	const translations = TRANSLATIONS[locale] ?? TRANSLATIONS["en"];

	// Verschachtelte Schlüssel auflösen
	const parts = key.split(".");
	let value: unknown = translations;
	for (const part of parts) {
		if (typeof value === "object" && value !== null) {
			value = (value as Record<string, unknown>)[part];
		} else {
			value = undefined;
			break;
		}
	}

	// Fallback auf Englisch wenn Schlüssel in der Zielsprache fehlt
	if (typeof value !== "string") {
		let fallback: unknown = TRANSLATIONS["en"];
		for (const part of parts) {
			if (typeof fallback === "object" && fallback !== null) {
				fallback = (fallback as Record<string, unknown>)[part];
			} else {
				fallback = undefined;
				break;
			}
		}
		value = typeof fallback === "string" ? fallback : key;
	}

	let result = value as string;

	// Template-Variablen ersetzen
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
		}
	}

	return result;
}
