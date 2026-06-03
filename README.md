# Wiktionary Sidebar

An Obsidian plugin that lets you look up any word in Wiktionary without leaving your vault.

**Right-click any selected word → "Wiktionary: „word"" → definitions appear in a sidebar.**

---

## Features

- Works in both **editor view** and **reading view**
- Supports **7 languages**: German, English, French, Italian, Swedish, Dutch, Spanish
- Each language can be **toggled individually** in settings
- **Direct links** to the source Wiktionary page for each language
- Shows structured entries: part of speech, definitions, etymology, synonyms, and more
- Respects Obsidian's **light and dark themes** via CSS variables
- Desktop only

## Installation

### From the Community Plugin Browser (recommended)

1. Open Obsidian → Settings → Community Plugins → Browse
2. Search for **Wiktionary Sidebar**
3. Install and enable

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Copy them to `.obsidian/plugins/wiktionary-sidebar/` in your vault
3. Enable the plugin in Settings → Community Plugins

## Usage

1. Select a word in any note (editor or reading view)
2. Right-click → **Wiktionary: „word"**
3. The sidebar opens with entries for all enabled languages

The sidebar updates every time you look up a new word and stays open until you close it.

## Settings

Open Settings → Wiktionary Sidebar to toggle languages on or off:

| Language   | Source                    | On by default |
|------------|---------------------------|---------------|
| Deutsch    | de.wiktionary.org         | ✓             |
| English    | en.wiktionary.org         | ✓             |
| Français   | fr.wiktionary.org         |               |
| Italiano   | it.wiktionary.org         |               |
| Svenska    | sv.wiktionary.org         |               |
| Nederlands | nl.wiktionary.org         |               |
| Español    | es.wiktionary.org         |               |

## How it works

Each language is fetched from its own native Wiktionary edition via the MediaWiki `action=parse` API — German from de.wiktionary.org, English from en.wiktionary.org, and so on. This means words with special characters (e.g. „autonomía") are found correctly on their native edition. The HTML response is parsed locally — no data leaves your machine beyond the Wiktionary API request itself.

## Compatibility

- Obsidian 0.15.0 or later
- Desktop only (Windows, macOS, Linux)

## License

MIT
