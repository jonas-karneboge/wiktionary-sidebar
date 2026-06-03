import esbuild from "esbuild";
import process from "process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const prod = process.argv[2] === "production";
const dir = dirname(fileURLToPath(import.meta.url));

// Node.js built-in modules — inline statt builtin-modules-Paket
const builtins = createRequire(import.meta.url)("module").builtinModules;

const context = await esbuild.context({
	entryPoints: [resolve(dir, "src/main.ts")],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: resolve(dir, "main.js"),
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
