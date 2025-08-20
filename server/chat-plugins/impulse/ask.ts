/**
 * /ask command
 * Uses Google Gemini via the Google Gen AI JS SDK (@google/genai).
 *
 * Features:
 * - /ask <prompt> -- ask Gemini and print result in the room
 * - Per-user cooldown: 20 seconds (configurable)
 * - Configurable model and cooldown via Config.ask (optional)
 *
 * Requirements:
 *  - npm install @google/genai
 *  - Set environment variable GEMINI_API_KEY (or add to Config.geminiKey)
 *
 * Devloped by TurboRx
 */

import {FS, Utils} from '../lib';

// Optional server-side config override (in config/config.js or config.ts)
// Config.ask = { model: 'gemini-2.5-flash', cooldown: 20 /* seconds */, apiKey: '...' }
const DEFAULT_MODEL = Config?.ask?.model || 'gemini-2.5-flash';
const DEFAULT_COOLDOWN_SECONDS = Number(Config?.ask?.cooldown) || 20; // <-- 20 seconds default
const ENV_API_KEY = process.env.GEMINI_API_KEY || Config?.geminiKey;

// Try to import the Google Gen AI SDK
let GoogleGenAI: any;
try {
	GoogleGenAI = require('@google/genai').GoogleGenAI || require('@google/genai').default || require('@google/genai');
} catch (e) {
	GoogleGenAI = null;
}

// Track last usage timestamps (ms since epoch) per user id
const lastUsed: Map<string, number> = new Map();

function secondsRemaining(lastMs: number, cooldownMs: number) {
	const remaining = Math.ceil(Math.max(0, (lastMs + cooldownMs - Date.now()) / 1000));
	return remaining;
}

async function queryGemini(prompt: string, model: string, apiKey?: string): Promise<string> {
	const key = apiKey || ENV_API_KEY;
	if (!key) throw new Error("Gemini API key not configured. Set GEMINI_API_KEY environment variable or Config.ask.apiKey.");

	if (!GoogleGenAI) {
		throw new Error("Missing dependency '@google/genai'. Install it with `npm install @google/genai` in your server directory.");
	}

	const ai = new GoogleGenAI({ apiKey: key });

	const res = await ai.models.generateContent({
		model,
		contents: prompt,
	});

	if (typeof res?.text === 'string' && res.text.trim()) return res.text.trim();

	if (Array.isArray(res?.candidates) && res.candidates[0]?.content) {
		const candidate = res.candidates[0];
		if (typeof candidate.content === 'string') return candidate.content.trim();
		if (Array.isArray(candidate.content)) return candidate.content.join('').trim();
	}

	if (Array.isArray(res?.output) && res.output[0]?.content) {
		const content = res.output[0].content;
		if (Array.isArray(content) && content[0]?.text) return content[0].text.trim();
	}

	return JSON.stringify(res, null, 2);
}

export const commands: Chat.ChatCommands = {
	ask(target, room, user) {
		(async () => {
			const prompt = (target || '').trim();
			if (!prompt) return this.errorReply("Usage: /ask <prompt>");

			const userid = toID(user.id);
			const cooldownMs = (Number(Config?.ask?.cooldown) || DEFAULT_COOLDOWN_SECONDS) * 1000;

			const last = lastUsed.get(userid) || 0;
			if (Date.now() < last + cooldownMs) {
				const sec = secondsRemaining(last, cooldownMs);
				return this.errorReply(`Please wait ${sec}s before using /ask again.`);
			}

			lastUsed.set(userid, Date.now());

			const model = Config?.ask?.model || DEFAULT_MODEL;
			const apiKey = Config?.geminiKey || ENV_API_KEY;

			this.sendReply(`Processing your request with ${model}...`);

			try {
				const responseText = await queryGemini(prompt, model, apiKey);

				const html = Utils.html`<div class="infobox" style="max-height:300px; overflow:auto;"><strong>/ask result</strong><br /><pre style="white-space:pre-wrap; margin:0;">${responseText}</pre></div>`;

				(room || this.room)?.add(`|c| Ask|/raw ${html}`).update();

				Monitor.log(`[ask] ${user.name} -> ${model}: ${prompt}`);
			} catch (err: any) {
				this.errorReply(`Error while contacting Gemini: ${err?.message || err}`);
				Monitor.crashlog(err);
			}
		})().catch(err => {
			Monitor.crashlog(err);
			this.errorReply(`Unexpected error: ${err?.message || err}`);
		});
	},

	askhelp: [
		`/ask <prompt> - Ask the configured LLM (Gemini) a question. Uses GEMINI_API_KEY environment variable or Config.ask.apiKey. Rate-limited per-user (20s default).`,
		`To configure: set environment variable GEMINI_API_KEY or put Config.ask = { apiKey: '...', model: 'gemini-2.5-flash', cooldown: 20 } in your server config.`,
	],
};

export const pages: Chat.PageTable = {
	asksettings: {
		index() {
			const model = Config?.ask?.model || DEFAULT_MODEL;
			const cooldown = Number(Config?.ask?.cooldown) || DEFAULT_COOLDOWN_SECONDS;
			const apiConfigured = !!(process.env.GEMINI_API_KEY || Config?.geminiKey);
			return `<div class="pad"><h2>/ask plugin</h2><p>Model: ${Utils.escapeHTML(model)}<br />Cooldown: ${Utils.escapeHTML(String(cooldown))}s<br />API Key configured: ${apiConfigured ? 'yes' : 'no'}</p></div>`;
		},
	},
};
