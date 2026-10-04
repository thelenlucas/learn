/**
 * flashcards — persist end-of-session spaced-repetition cards to Obsidian.
 *
 * Cards are written in the syntax of the Obsidian Spaced Repetition plugin
 * (st3v3nmw/obsidian-spaced-repetition), default settings:
 *
 *   - The deck note carries a `#flashcards` tag (any `#flashcards/...` nested
 *     deck tag the user puts there is respected and left alone).
 *   - basic     →  multi-line card:   front \n ? \n back
 *   - reversed  →  multi-line card:   front \n ?? \n back   (reviewed both ways)
 *   - cloze     →  text with ==highlighted== deletions
 *   - Cards are separated by blank lines, so card text must never contain one.
 *
 * The plugin appends its own scheduling comment (<!--SR:...-->) under each
 * card after a review; this extension only ever appends, never rewrites, so
 * that state is preserved.
 *
 * Which file is the deck:
 *   1. the file linked with /flashcards-deck <path>, else
 *   2. "<md-log file name> - flashcards.md" next to the linked md-log file.
 *   Otherwise the tool fails and tells the agent to ask the user for a deck.
 *
 * Commands:
 *   /flashcards              — run the end-of-session card step now
 *   /flashcards-deck <path>  — use <path> as the deck (created if missing)
 *   /flashcards-deck         — show the current deck
 *   /flashcards-undeck       — forget the linked deck (fall back to rule 2)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type CardKind = "basic" | "reversed" | "cloze";

interface CardInput {
	kind: CardKind;
	front?: string;
	back?: string;
	text?: string;
}

interface SaveDetails {
	deck: string;
	topic: string;
	written: number;
	skipped: Array<{ card: string; reason: string }>;
}

const CardSchema = Type.Object({
	kind: Type.Union([Type.Literal("basic"), Type.Literal("reversed"), Type.Literal("cloze")], {
		description:
			'"basic" = front→back. "reversed" = also reviewed back→front; only for genuine two-way pairs (term⇄definition). "cloze" = `text` with ==deletions==.',
	}),
	front: Type.Optional(Type.String({ description: "Question side (basic/reversed)." })),
	back: Type.Optional(Type.String({ description: "Answer side (basic/reversed)." })),
	text: Type.Optional(
		Type.String({ description: "Cloze only: full sentence with each deletion wrapped in ==double equals==." }),
	),
});

const SaveParams = Type.Object({
	topic: Type.String({
		description: "Short title of what this session taught. Becomes the section heading in the deck.",
	}),
	cards: Type.Array(CardSchema, { minItems: 1 }),
});

const CLOZE_RE = /==[^=\n][^\n]*?==/;

export default function flashcards(pi: ExtensionAPI) {
	let deckFile: string | null = null; // explicitly linked deck
	let mdLogFile: string | null = null; // mirrored from md-log's session entries

	function refreshStatus(ctx: any) {
		const deck = resolveDeck();
		if (!deck) {
			ctx.ui.setStatus("flashcards", undefined);
			return;
		}
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("flashcards", theme.fg("accent", "🃏 ") + theme.fg("dim", path.basename(deck)));
	}

	function resolveDeck(): string | null {
		if (deckFile) return deckFile;
		if (mdLogFile) {
			const dir = path.dirname(mdLogFile);
			const base = path.basename(mdLogFile, path.extname(mdLogFile));
			return path.join(dir, `${base} - flashcards.md`);
		}
		return null;
	}

	function scanEntries(ctx: any) {
		deckFile = null;
		mdLogFile = null;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "flashcards-deck") deckFile = (entry.data as any)?.file ?? null;
			if (entry.customType === "md-log") mdLogFile = (entry.data as any)?.file ?? null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		scanEntries(ctx);
		refreshStatus(ctx);
	});

	// md-log links/unlinks by appending a custom entry; pick that up after
	// every command-driven turn so the fallback deck path tracks it.
	pi.on("agent_start", async (_event, ctx) => {
		scanEntries(ctx);
		refreshStatus(ctx);
	});

	// --- Serialized file writes ---

	let writeLock: Promise<void> = Promise.resolve();
	function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const prev = writeLock;
		let release: () => void;
		writeLock = new Promise<void>((r) => {
			release = r;
		});
		return prev.then(fn).finally(() => release!());
	}

	// --- Card formatting ---

	// A blank line ends a card in the SR plugin, so collapse any.
	function clean(s: string): string {
		return s
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((l) => l.replace(/\s+$/, ""))
			.filter((l) => l.trim().length > 0)
			.join("\n")
			.trim();
	}

	function normalizeKey(s: string): string {
		return s.toLowerCase().replace(/\s+/g, " ").trim();
	}

	function validate(card: CardInput): { ok: true; block: string; key: string } | { ok: false; reason: string } {
		if (card.kind === "cloze") {
			const text = clean(card.text ?? card.front ?? "");
			if (!text) return { ok: false, reason: "cloze card has no text" };
			if (!CLOZE_RE.test(text)) return { ok: false, reason: "cloze card has no ==deletion==" };
			if (text.includes("::")) return { ok: false, reason: 'contains "::" (the plugin would parse it as an inline card)' };
			if (/^\?{1,2}$/m.test(text)) return { ok: false, reason: 'contains a line that is just "?" or "??"' };
			return { ok: true, block: text, key: normalizeKey(text) };
		}
		const front = clean(card.front ?? "");
		const back = clean(card.back ?? "");
		if (!front || !back) return { ok: false, reason: `${card.kind} card needs both front and back` };
		const all = `${front}\n${back}`;
		if (all.includes("::")) return { ok: false, reason: 'contains "::" (the plugin would parse it as an inline card)' };
		if (/^\?{1,2}$/m.test(all)) return { ok: false, reason: 'contains a line that is just "?" or "??"' };
		if (CLOZE_RE.test(all)) return { ok: false, reason: "contains ==highlight== (would be parsed as a cloze)" };
		const sep = card.kind === "reversed" ? "??" : "?";
		return { ok: true, block: `${front}\n${sep}\n${back}`, key: normalizeKey(front) };
	}

	// Keys of cards already in the deck, so re-running a session doesn't duplicate.
	function existingKeys(content: string): Set<string> {
		const keys = new Set<string>();
		for (const chunk of content.split(/\n\s*\n/)) {
			const lines = chunk
				.split("\n")
				.map((l) => l.replace(/<!--SR:.*?-->/g, "").trimEnd())
				.filter((l) => l.trim().length > 0);
			const sepIdx = lines.findIndex((l) => l.trim() === "?" || l.trim() === "??");
			if (sepIdx > 0) keys.add(normalizeKey(lines.slice(0, sepIdx).join("\n")));
			else if (CLOZE_RE.test(chunk)) keys.add(normalizeKey(lines.join("\n")));
		}
		return keys;
	}

	function today(): string {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	// --- Tool ---

	pi.registerTool({
		name: "save_flashcards",
		label: "save_flashcards",
		description:
			"Append spaced-repetition flashcards for this session to the user's Obsidian deck (Obsidian Spaced Repetition plugin format). Call ONCE at the end of a teaching session with the full set of cards. Formatting (separators, #flashcards tag, headings, dedup) is handled for you — pass plain card content.",
		promptSnippet: "Save end-of-session flashcards to the Obsidian spaced-repetition deck.",
		promptGuidelines: [
			"Call save_flashcards once per session, at the end, after loading the flashcards skill.",
			"Card text must not contain blank lines or '::'. Use LaTeX ($...$) for math.",
			"Use ==...== only inside cloze cards.",
		],
		parameters: SaveParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			scanEntries(ctx);
			const deck = resolveDeck();
			if (!deck) {
				throw new Error(
					"No flashcard deck configured. Ask the user to run /flashcards-deck <path-to-note.md> (or link a session log with /md-log), then call save_flashcards again.",
				);
			}
			if (!fs.existsSync(path.dirname(deck))) {
				throw new Error(`Deck directory does not exist: ${path.dirname(deck)}`);
			}

			const topic = clean(params.topic).replace(/\n/g, " ") || "Session";

			return withLock(() => {
				const current = fs.existsSync(deck) ? fs.readFileSync(deck, "utf-8") : "";
				const seen = existingKeys(current);
				const blocks: string[] = [];
				const skipped: SaveDetails["skipped"] = [];

				for (const card of params.cards as CardInput[]) {
					const v = validate(card);
					const label = (card.front ?? card.text ?? "").slice(0, 60);
					if (!v.ok) {
						skipped.push({ card: label, reason: v.reason });
						continue;
					}
					if (seen.has(v.key)) {
						skipped.push({ card: label, reason: "already in deck" });
						continue;
					}
					seen.add(v.key);
					blocks.push(v.block);
				}

				if (blocks.length > 0) {
					let out = current;
					if (!/(^|\s)#flashcards\b/.test(out)) {
						out = `#flashcards\n\n${out.trimStart()}`;
					}
					const header: string[] = [`## ${topic} (${today()})`];
					if (mdLogFile && path.resolve(mdLogFile) !== path.resolve(deck)) {
						header.push(`Source: [[${path.basename(mdLogFile, path.extname(mdLogFile))}]]`);
					}
					const section = [header.join("\n\n"), ...blocks].join("\n\n");
					out = out.trimEnd() + "\n\n" + section + "\n";
					fs.writeFileSync(deck, out, "utf-8");
				}

				const details: SaveDetails = { deck, topic, written: blocks.length, skipped };
				let text = `Wrote ${blocks.length} card(s) to ${deck}.`;
				if (skipped.length > 0) {
					text +=
						`\nSkipped ${skipped.length}:\n` +
						skipped.map((s) => `- "${s.card}" — ${s.reason}`).join("\n") +
						(skipped.some((s) => s.reason !== "already in deck")
							? "\nFix and resubmit the invalid cards (not the duplicates)."
							: "");
				}
				return { content: [{ type: "text", text }], details };
			});
		},

		renderCall(args, theme) {
			const n = Array.isArray(args.cards) ? args.cards.length : 0;
			return new Text(
				theme.fg("toolTitle", theme.bold("save_flashcards ")) + theme.fg("muted", `${args.topic ?? ""} — ${n} card(s)`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const d = result.details as SaveDetails | undefined;
			if (!d) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			const lines = [theme.fg("success", "✓ ") + theme.fg("accent", `${d.written} card(s) → ${path.basename(d.deck)}`)];
			for (const s of d.skipped) lines.push(theme.fg("warning", `  skipped: ${s.card} — ${s.reason}`));
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	// --- Commands ---

	pi.registerCommand("flashcards", {
		description: "End-of-session: generate spaced-repetition flashcards for this session",
		handler: async (_args, ctx: any) => {
			scanEntries(ctx);
			if (!resolveDeck()) {
				ctx.ui.notify("No deck. Run /flashcards-deck <path> (or /md-log <file>) first.", "warning");
				return;
			}
			pi.sendUserMessage(
				"We're wrapping up this session. Load the flashcards skill and create the spaced-repetition cards for what we covered, then save them with save_flashcards.",
				{ deliverAs: "followUp" },
			);
		},
	});

	pi.registerCommand("flashcards-deck", {
		description: "Set (or show) the Obsidian note that end-of-session flashcards are appended to",
		handler: async (args, ctx: any) => {
			scanEntries(ctx);
			const filepath = args.trim();
			if (!filepath) {
				const deck = resolveDeck();
				ctx.ui.notify(
					deck ? `Deck: ${deck}${deckFile ? "" : " (default, next to md-log file)"}` : "No deck set. Usage: /flashcards-deck <path>",
					"info",
				);
				return;
			}
			const resolved = path.isAbsolute(filepath) ? filepath : path.resolve(ctx.cwd, filepath);
			if (path.extname(resolved).toLowerCase() !== ".md") {
				ctx.ui.notify("Deck must be a .md file", "error");
				return;
			}
			if (!fs.existsSync(path.dirname(resolved))) {
				ctx.ui.notify(`Directory does not exist: ${path.dirname(resolved)}`, "error");
				return;
			}
			if (fs.existsSync(resolved) && !fs.statSync(resolved).isFile()) {
				ctx.ui.notify(`Not a file: ${resolved}`, "error");
				return;
			}
			deckFile = resolved;
			pi.appendEntry("flashcards-deck", { file: resolved });
			refreshStatus(ctx);
			ctx.ui.notify(`Flashcard deck: ${resolved}`, "success");
		},
	});

	pi.registerCommand("flashcards-undeck", {
		description: "Forget the linked flashcard deck",
		handler: async (_args, ctx: any) => {
			deckFile = null;
			pi.appendEntry("flashcards-deck", { file: null });
			refreshStatus(ctx);
			ctx.ui.notify("Flashcard deck unlinked", "info");
		},
	});
}
