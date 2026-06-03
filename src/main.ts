/*
 * Wiktionary Sidebar – Obsidian Community Plugin
 * Datei: src/main.ts
 *
 *  DE  – heading3=word class, p=label, dl>dd=content
 *  FR  – heading3=word class, ol>li=definitions, heading4=sub-label with ul>li
 *  IT  – heading3=word class, ol>li=definitions, weitere heading3=sub-label with ul>li
 *  SV  – heading3=word class, ol>li=definitions, heading4=sub-label (ignored)
 *  EN  – heading4=word class, ol>li=definitions, heading5=sub-label with ul>li
 *  NL  – heading4=word class, ol>li=definitions, heading5=sub-label with ul>li
 *  ES  – heading3=etymology → heading4=word class, dl>dd=content (dt=numbers, ignored)
 */

import {
	App,
	Editor,
	ItemView,
	Menu,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";
import { t } from "./i18n";

// ── Typen ────────────────────────────────────────────────────────────────────

type ParserVariant = "DE" | "FR_IT_SV" | "EN_NL" | "ES";

interface LangConfig {
	code: string;
	label: string;
	apiLang: string;
	sectionName: string;
	wikiUrl: string;
	defaultOn: boolean;
	variant: ParserVariant;
}

interface SubSection {
	label: string | null;
	items: string[];
}

interface PosBlock {
	partOfSpeech: string;
	subSections: SubSection[];
}

type WiktionarySettings = Record<string, boolean>;

// ── Language settings ──────────────────────────────────────────────────────

const LANGUAGES: LangConfig[] = [
	{ code: "de", label: "Deutsch",    apiLang: "de", sectionName: "Deutsch",    wikiUrl: "https://de.wiktionary.org/wiki/", defaultOn: true,  variant: "DE"     },
	{ code: "en", label: "English",    apiLang: "en", sectionName: "English",    wikiUrl: "https://en.wiktionary.org/wiki/", defaultOn: true,  variant: "EN_NL"  },
	{ code: "fr", label: "Français",   apiLang: "fr", sectionName: "Français",   wikiUrl: "https://fr.wiktionary.org/wiki/", defaultOn: false, variant: "FR_IT_SV" },
	{ code: "it", label: "Italiano",   apiLang: "it", sectionName: "Italiano",   wikiUrl: "https://it.wiktionary.org/wiki/", defaultOn: false, variant: "FR_IT_SV" },
	{ code: "sv", label: "Svenska",    apiLang: "sv", sectionName: "Svenska",    wikiUrl: "https://sv.wiktionary.org/wiki/", defaultOn: false, variant: "FR_IT_SV" },
	{ code: "nl", label: "Nederlands", apiLang: "nl", sectionName: "Nederlands", wikiUrl: "https://nl.wiktionary.org/wiki/", defaultOn: false, variant: "EN_NL"  },
	{ code: "es", label: "Español",    apiLang: "es", sectionName: "Español",    wikiUrl: "https://es.wiktionary.org/wiki/", defaultOn: false, variant: "ES"     },
];

const VIEW_TYPE = "wiktionary-sidebar";

function buildDefaultSettings(): WiktionarySettings {
	const s: WiktionarySettings = {};
	for (const lang of LANGUAGES) s[lang.code] = lang.defaultOn;
	return s;
}

// ── API ──────────────────────────────────────────────────────────────────────

async function fetchWiktionaryHTML(word: string, apiLang: string): Promise<string | null> {
	const url =
		`https://${apiLang}.wiktionary.org/w/api.php` +
		`?action=parse&page=${encodeURIComponent(word)}&prop=text&format=json&origin=*`;
	try {
		const r = await fetch(url);
		if (!r.ok) return null;
		const data = await r.json();
		if (data.error || !data.parse?.text) return null;
		return data.parse.text["*"] as string;
	} catch {
		return null;
	}
}

// ── Parser helper functions ───────────────────────────────────────────────────

function headingText(el: Element): string {
	const clone = el.cloneNode(true) as Element;
	clone.querySelectorAll(".mw-editsection").forEach((n) => n.remove());
	return clone.textContent?.trim() ?? "";
}

function stripLineNumbers(text: string): string {
	return text.replace(/^\s*(\[\d+]\s*)+/, "").trim();
}

function cleanText(el: Element, removeNested = false): string {
	const clone = el.cloneNode(true) as Element;
	clone.querySelectorAll("sup, .reference").forEach((n) => n.remove());
	if (removeNested) clone.querySelectorAll("ul, ol, dl").forEach((n) => n.remove());
	return stripLineNumbers(clone.textContent?.trim() ?? "");
}

/** All <li>-children of a <ol> or <ul> as text. Nested lists are removed. */
function listItems(el: Element): string[] {
	const items: string[] = [];
	const children = el.children;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const tag = child.tagName.toLowerCase();
		if (tag !== "li") continue;
		const text = cleanText(child, true);
		if (text.length > 0) items.push(text);
	}
	return items;
}

/** All <dd>-children of a  <dl> as text. <dt>-elements are ignored (numbers in ES) */
function dlItems(el: Element): string[] {
	const items: string[] = [];
	const children = el.children;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.tagName.toLowerCase() !== "dd") continue;
		const text = cleanText(child, true); // true = remove nested lists
		if (text.length > 0) items.push(text);
	}
	return items;
}

/** Finds the starting point of a language block based on the sectionName. */
function findBlockStart(doc: Document, sectionName: string): Element | null {
	const h2list = doc.querySelectorAll("div.mw-heading2");
	for (let i = 0; i < h2list.length; i++) {
		if (headingText(h2list[i]).includes(sectionName)) return h2list[i];
	}
	return null;
}

// ── Parser DE ─────────────────────────────────────────────────────────────────
//
// heading3 = word class
// p        = Sub-Label (z. B. „Bedeutungen:", „Synonyme:")
// dl > dd  = Eintragszeile

function parseDE(doc: Document): PosBlock[] {
	const blockStart = findBlockStart(doc, "Deutsch");
	if (!blockStart) return [];

	const posList: PosBlock[] = [];
	let currentPOS: PosBlock | null = null;
	let currentSub: SubSection | null = null;
	let pendingLabel: string | null = null;

	function flushSub(): void {
		if (currentSub && currentPOS && currentSub.items.length > 0)
			currentPOS.subSections.push(currentSub);
		currentSub = null;
	}
	function flushPOS(): void {
		flushSub();
		if (currentPOS) { posList.push(currentPOS); currentPOS = null; }
	}

	let el: Element | null = blockStart.nextElementSibling;
	while (el) {
		const tag = el.tagName.toLowerCase();
		const cls = el.className ?? "";
		if (cls.includes("mw-heading2")) break;

		if (cls.includes("mw-heading3")) {
			flushPOS();
			currentPOS = { partOfSpeech: headingText(el), subSections: [] };
			pendingLabel = null;
		} else if (cls.includes("mw-heading4")) {
			flushSub(); pendingLabel = null;
		} else if (currentPOS) {
			if (tag === "p") {
				const clone = el.cloneNode(true) as Element;
				clone.querySelectorAll(".mw-editsection, sup, .reference").forEach((n) => n.remove());
				const text = clone.textContent?.trim().replace(/:$/, "") ?? "";
				if (text.length > 0) pendingLabel = text;
			} else if (tag === "dl") {
				flushSub();
				currentSub = { label: pendingLabel, items: dlItems(el) };
				pendingLabel = null;
			}
		}
		el = el.nextElementSibling;
	}
	flushPOS();
	return posList;
}

// ── Meta heading lists ───────────────────────────────────────────────────────
// Heading texts that are NOT types of words, but meta-sections.
// Anything not included in the list is treated as a word type.

const META_H3_FR_IT_SV = new Set([
	// FR
	"Étymologie", "Prononciation", "Voir aussi", "Références", "Anagrammes",
	"Paronymes", "Homophones",
	// IT
	"Sillabazione", "Pronuncia", "Etimologia / Derivazione",
	"Sinonimi", "Contrari", "Termini correlati", "Traduzione",
	"Note / Riferimenti", "Parole derivate", "Alterati",
	// SV
	"Etymologi", "Se även", "Uttal",
]);

const META_H3_EN_NL = new Set([
	// EN – numbered etymologies
	"Etymology", "Etymology 1", "Etymology 2", "Etymology 3", "Etymology 4",
	"Pronunciation", "Further reading", "References", "See also",
	"Alternative forms",
	// NL
	"Woordherkomst en -opbouw", "Uitspraak", "Woordafbreking",
]);

const META_H4_EN_NL = new Set([
	// EN
	"Derived terms", "Related terms", "Translations", "See also",
	"Synonyms", "Antonyms", "Hypernyms", "Hyponyms",
	"Holonyms", "Meronyms", "Coordinate terms", "Usage notes",
	"References", "Further reading", "Anagrams", "Alternative forms",
	"Quotations", "Descendants",
	// NL
	"Gangbaarheid", "Meer informatie", "Verwijzingen", "Vertalingen",
	"Antoniemen", "Hyponiemen", "Afgeleide begrippen",
]);


//
// heading3 = Word type (and, in IT, sub-labels such as „Sinonimi", „Contrari")
// ol > li  = Definitions (immediately after heading3)
// heading4 = Sub-label (FR/SV) or ignored

function parseFR_IT_SV(doc: Document, sectionName: string): PosBlock[] {
	const blockStart = findBlockStart(doc, sectionName);
	if (!blockStart) return [];

	// → META_H3_FR_IT_SV (module constant above)

	const posList: PosBlock[] = [];
	let currentPOS: PosBlock | null = null;
	let currentSub: SubSection | null = null;

	function flushSub(): void {
		if (currentSub && currentPOS && currentSub.items.length > 0)
			currentPOS.subSections.push(currentSub);
		currentSub = null;
	}
	function flushPOS(): void {
		flushSub();
		if (currentPOS) { posList.push(currentPOS); currentPOS = null; }
	}

	let el: Element | null = blockStart.nextElementSibling;
	while (el) {
		const tag = el.tagName.toLowerCase();
		const cls = el.className ?? "";
		if (cls.includes("mw-heading2")) break;

		if (cls.includes("mw-heading3")) {
			const text = headingText(el);
			if (META_H3_FR_IT_SV.has(text)) {
				// Bei IT: Meta-heading3 als Sub-Label verwenden
				if (currentPOS) {
					flushSub();
					// Nächstes Element prüfen ob es ein ul/ol ist
					const next = el.nextElementSibling;
					if (next) {
						const ntag = next.tagName.toLowerCase();
						if (ntag === "ul" || ntag === "ol") {
							currentSub = { label: text, items: listItems(next) };
						}
					}
				}
			} else {
				flushPOS();
				currentPOS = { partOfSpeech: text, subSections: [] };
			}
		} else if (cls.includes("mw-heading4")) {
			// FR/SV: heading4 as a sub-label — only if the following contains ul/ol elements
			if (currentPOS) {
				flushSub();
				const next = el.nextElementSibling;
				if (next) {
					const ntag = next.tagName.toLowerCase();
					if (ntag === "ul" || ntag === "ol") {
						const items = listItems(next);
						if (items.length > 0) {
							currentSub = { label: headingText(el), items };
						}
					}
				}
			}
		} else if (currentPOS && (tag === "ol" || tag === "ul")) {
			// Definitions immediately following heading3 (no preceding sub-label)
			// Only if no currentSub is already running
			if (!currentSub) {
				currentSub = { label: null, items: listItems(el) };
			}
		}

		el = el.nextElementSibling;
	}
	flushPOS();
	return posList;
}

// ── Parser EN / NL ────────────────────────────────────────────────────────────
//
// heading4 = Word type (heading3 = Etymology / meta)
// ol > li  = definitions
// heading5 = Sub-label (Synonyms, Hypernyms, …) with ul > li

function parseEN_NL(doc: Document, sectionName: string): PosBlock[] {
	const blockStart = findBlockStart(doc, sectionName);
	if (!blockStart) return [];

	// heading3 text that is NOT a word type → META_H3_EN_NL
	// heading4 text that is NOT a word type → META_H4_EN_NL

	const posList: PosBlock[] = [];
	let currentPOS: PosBlock | null = null;
	let currentSub: SubSection | null = null;

	function flushSub(): void {
		if (currentSub && currentPOS && currentSub.items.length > 0)
			currentPOS.subSections.push(currentSub);
		currentSub = null;
	}
	function flushPOS(): void {
		flushSub();
		if (currentPOS) { posList.push(currentPOS); currentPOS = null; }
	}

	let el: Element | null = blockStart.nextElementSibling;
	while (el) {
		const tag = el.tagName.toLowerCase();
		const cls = el.className ?? "";
		if (cls.includes("mw-heading2")) break;

		if (cls.includes("mw-heading3")) {
			const text = headingText(el);
			if (META_H3_EN_NL.has(text)) {
				// Meta-Sektion: POS flushen, keinen neuen anlegen
				flushPOS();
			} else {
				// Word type directly at heading3 level (e.g. „Noun")
				flushPOS();
				currentPOS = { partOfSpeech: text, subSections: [] };
			}
		} else if (cls.includes("mw-heading4")) {
			const text = headingText(el);
			if (META_H4_EN_NL.has(text)) {
				// Meta section: Flush sub, do not create a new sub from the following ul
				flushSub();
			} else {
				// Word type at heading4 level
				flushPOS();
				currentPOS = { partOfSpeech: text, subSections: [] };
			}
		} else if (cls.includes("mw-heading5")) {
			// Sub-label: always flush, then use the next ul as the content
			flushSub();
			if (currentPOS) {
				const next = el.nextElementSibling;
				if (next && (next.tagName.toLowerCase() === "ul" || next.tagName.toLowerCase() === "ol")) {
					const items = listItems(next);
					if (items.length > 0) {
						currentSub = { label: headingText(el), items };
					}
				}
			}
		} else if (currentPOS && (tag === "ol" || tag === "ul") && !currentSub) {
			currentSub = { label: null, items: listItems(el) };
		}

		el = el.nextElementSibling;
	}
	flushPOS();
	return posList;
}

// ── Parser ES ─────────────────────────────────────────────────────────────────
//
// heading3 = „Etimología N" (flushed, no POS)
// heading4 = Word type (e.g. „Sustantivo femenino")
// dl > dd  = Definitions (dt = numbers, are ignored)
// Nested ul tags within dd tags = will be removed

function parseES(doc: Document): PosBlock[] {
	const blockStart = findBlockStart(doc, "Español");
	if (!blockStart) return [];

	const posList: PosBlock[] = [];
	let currentPOS: PosBlock | null = null;
	let currentSub: SubSection | null = null;

	function flushSub(): void {
		if (currentSub && currentPOS && currentSub.items.length > 0)
			currentPOS.subSections.push(currentSub);
		currentSub = null;
	}
	function flushPOS(): void {
		flushSub();
		if (currentPOS) { posList.push(currentPOS); currentPOS = null; }
	}

	let el: Element | null = blockStart.nextElementSibling;
	while (el) {
		const tag = el.tagName.toLowerCase();
		const cls = el.className ?? "";
		if (cls.includes("mw-heading2")) break;

		if (cls.includes("mw-heading3")) {
			flushPOS();
		} else if (cls.includes("mw-heading4")) {
			const text = headingText(el);
			if (text === "Traducciones" || text === "Véase también") {
				flushSub();
			} else {
				flushPOS();
				currentPOS = { partOfSpeech: text, subSections: [] };
			}
		} else if (currentPOS && tag === "dl") {
			if (!currentSub) currentSub = { label: null, items: [] };
			const newItems = dlItems(el);
			for (let i = 0; i < newItems.length; i++) currentSub.items.push(newItems[i]);
		}

		el = el.nextElementSibling;
	}
	flushPOS();
	return posList;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

function parseHTML(html: string, lang: LangConfig): PosBlock[] {
	const doc = new DOMParser().parseFromString(html, "text/html");
	switch (lang.variant) {
		case "DE":      return parseDE(doc);
		case "FR_IT_SV": return parseFR_IT_SV(doc, lang.sectionName);
		case "EN_NL":   return parseEN_NL(doc, lang.sectionName);
		case "ES":      return parseES(doc);
	}
}

// ── ItemView ─────────────────────────────────────────────────────────────────

class WiktionarySidebarView extends ItemView {
	private plugin: WiktionaryPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: WiktionaryPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return "Wiktionary"; }
	getIcon(): string { return "book-open"; }
	async onOpen(): Promise<void> { this.renderEmpty(); }
	async onClose(): Promise<void> {}

	async lookup(word: string): Promise<void> {
		this.renderLoading(word);

		const activeLangs = LANGUAGES.filter((l) => this.plugin.settings[l.code]);
		const fetches = activeLangs.map((lang) =>
			fetchWiktionaryHTML(word, lang.apiLang).then((html) => ({
				lang,
				sections: html ? parseHTML(html, lang) : null,
			}))
		);
		const resolved = await Promise.all(fetches);
		const results = new Map(resolved.map((r) => [r.lang.code, r.sections]));
		this.render(word, activeLangs, results);
	}

	private container(): HTMLElement {
		return this.containerEl.children[1] as HTMLElement;
	}

	private renderEmpty(): void {
		const c = this.container();
		c.empty(); c.addClass("wiktionary-container");
		c.createEl("p", { cls: "wiktionary-placeholder", text: t("placeholder") });
	}

	private renderLoading(word: string): void {
		const c = this.container();
		c.empty(); c.addClass("wiktionary-container");
		c.createEl("p", { cls: "wiktionary-loading", text: t("loading", { word }) });
	}

	private render(word: string, activeLangs: LangConfig[], results: Map<string, PosBlock[] | null>): void {
		const c = this.container();
		c.empty(); c.addClass("wiktionary-container");
		c.createEl("div", { cls: "wiktionary-header" })
			.createEl("h2", { cls: "wiktionary-word", text: word });

		if (activeLangs.length === 0) {
			c.createEl("p", { cls: "wiktionary-placeholder", text: t("allDisabled") });
			return;
		}

		for (const lang of activeLangs) {
			const sections = results.get(lang.code) ?? null;
			const block = c.createEl("div", { cls: "wiktionary-lang-block" });
			const title = block.createEl("div", { cls: "wiktionary-lang-title" });
			title.createEl("span", { cls: "wiktionary-lang-label", text: lang.label });
			title.createEl("a", {
				cls: "wiktionary-lang-link",
				text: `${lang.apiLang}.wiktionary.org ↗`,
				href: `${lang.wikiUrl}${encodeURIComponent(word)}`,
			});

			if (sections === null) {
				block.createEl("p", { cls: "wiktionary-not-found", text: t("notFound") });
			} else if (sections.length === 0) {
				block.createEl("p", { cls: "wiktionary-not-found", text: t("noLangEntry", { lang: lang.label }) });
			} else {
				this.renderSections(block, sections);
			}
		}
	}

	private renderSections(parent: HTMLElement, posList: PosBlock[]): void {
		for (const pos of posList) {
			const posEl = parent.createEl("div", { cls: "wiktionary-pos-block" });
			posEl.createEl("h4", { cls: "wiktionary-pos", text: pos.partOfSpeech });
			if (!pos.subSections?.length) {
				posEl.createEl("p", { cls: "wiktionary-no-defs", text: t("noEntries") });
				continue;
			}
			for (const sub of pos.subSections) {
				if (!sub.items.length) continue;
				const subEl = posEl.createEl("div", { cls: "wiktionary-subsection" });
				if (sub.label) subEl.createEl("p", { cls: "wiktionary-sublabel", text: sub.label });
				const ol = subEl.createEl("ol", { cls: "wiktionary-defs" });
				for (const item of sub.items) ol.createEl("li", { text: item });
			}
		}
	}
}

// ── Settings ─────────────────────────────────────────────────────────────

class WiktionarySettingTab extends PluginSettingTab {
	private plugin: WiktionaryPlugin;

	constructor(app: App, plugin: WiktionaryPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: t("settings.title") });
		containerEl.createEl("p", {
			cls: "wiktionary-settings-desc",
			text: t("settings.desc"),
		});
		for (const lang of LANGUAGES) {
			new Setting(containerEl)
				.setName(lang.label)
				.setDesc(t("settings.toggleDesc", { lang: lang.apiLang }))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings[lang.code] ?? lang.defaultOn)
						.onChange(async (value: boolean) => {
							this.plugin.settings[lang.code] = value;
							await this.plugin.saveSettings();
						})
				);
		}
	}
}

// ── Main plugin class ───────────────────────────────────────────────────────

export default class WiktionaryPlugin extends Plugin {
	settings!: WiktionarySettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(VIEW_TYPE, (leaf) => new WiktionarySidebarView(leaf, this));
		this.addSettingTab(new WiktionarySettingTab(this.app, this));

		this.registerEvent(
			(this.app.workspace as any).on(
				"editor-menu",
				(menu: Menu, editor: Editor, _view: MarkdownView) => {
					const word = editor.getSelection().trim().split(/\s+/)[0];
					if (!word) return;
					menu.addItem((item) =>
						item.setTitle(t("contextMenu", { word })).setIcon("book-open")
							.onClick(() => this.openSidebarAndLookup(word))
					);
				}
			)
		);

		this.registerDomEvent(document, "contextmenu", (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (!target.closest(".markdown-preview-view")) return;
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed) return;
			const selectedText = selection.toString().trim();
			const word = selectedText.split(/\s+/)[0];
			if (!word) return;
			evt.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => item.setTitle(t("copy")).setIcon("copy")
				.onClick(() => navigator.clipboard.writeText(selectedText)));
			menu.addSeparator();
			menu.addItem((item) =>
				item.setTitle(t("contextMenu", { word })).setIcon("book-open")
					.onClick(() => this.openSidebarAndLookup(word))
			);
			menu.showAtMouseEvent(evt);
		});
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async openSidebarAndLookup(word: string): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
		if (leaf.view instanceof WiktionarySidebarView) await leaf.view.lookup(word);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(buildDefaultSettings(), await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}