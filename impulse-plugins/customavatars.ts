/******************************************
* Pokemon Showdown Custom Avatar Commands *
* Original Code By: CreatePhil And Others *
* Updated To Typescript By: Prince Sky    *
*******************************************/

import { FS } from '../lib/fs';

let sharp: typeof import('sharp') | null = null;
let SHARP_AVAILABLE = true;
try {
	sharp = require('sharp');
} catch {
	console.warn('[CustomAvatars] Sharp not installed, image resizing disabled.');
	SHARP_AVAILABLE = false;
}

const AVATAR_PATH = 'config/avatars/';
const STAFF_ROOM_ID = 'staff';
const VALID_EXTENSIONS = ['.jpg', '.png', '.gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const REQUIRED_WIDTH = 80;
const REQUIRED_HEIGHT = 80;
const AVATAR_BASE_URL = 'https://impulse-server.fun/avatars/';

function getExtension(filename: string): string {
	const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
	return ext || '';
}

function validateUrl(url: string): URL | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') return null;
		return parsed;
	} catch {
		return null;
	}
}

async function downloadAndValidateImage(imageUrl: string, name: string, extension: string): Promise<{ resized: boolean }> {
	const response = await fetch(imageUrl);
	if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

	const contentType = response.headers.get('content-type');
	if (!contentType?.startsWith('image/')) throw new Error(`Invalid content type: ${contentType}`);

	const buffer = Buffer.from(await response.arrayBuffer());
	if (buffer.byteLength > MAX_FILE_SIZE) {
		throw new Error(`File too large. Max allowed size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
	}

	let processedBuffer = buffer;
	let resized = false;

	if (SHARP_AVAILABLE && sharp) {
		const metadata = await sharp(buffer).metadata();

		// Auto-resize to 80x80 while preserving aspect ratio
		if (metadata.width !== REQUIRED_WIDTH || metadata.height !== REQUIRED_HEIGHT) {
			processedBuffer = await sharp(buffer)
				.resize(REQUIRED_WIDTH, REQUIRED_HEIGHT, {
					fit: 'contain',
					background: { r: 255, g: 255, b: 255, alpha: 0 }, // transparent padding
				})
				.toBuffer();
			resized = true;
		}
	}

	await FS(AVATAR_PATH + name + extension).write(processedBuffer);
	return { resized };
}

async function initializeAvatars(): Promise<void> {
	try {
		const files = await FS(AVATAR_PATH).readdir();
		if (!files) return;
		files
			.filter(file => VALID_EXTENSIONS.includes(getExtension(file)))
			.forEach(file => {
				const ext = getExtension(file);
				const name = file.slice(0, -ext.length);
				Config.customavatars = Config.customavatars || {};
				Config.customavatars[name] = file;
			});
	} catch (err) {
		console.error('Error loading avatars:', err);
	}
}

initializeAvatars();

export const commands: Chat.ChatCommands = {
	customavatar: {
		async set(this: CommandContext, target: string, room: ChatRoom | null, user: User) {
			this.checkCan('bypassall');
			const [name, avatarUrlRaw] = target.split(',').map(s => s.trim());
			if (!name || !avatarUrlRaw) return this.parse('/help customavatar');

			const userId = toID(name);
			const parsedUrl = validateUrl(avatarUrlRaw);
			if (!parsedUrl) {
				return this.errorReply('Invalid URL. Must be HTTPS.');
			}

			const ext = getExtension(parsedUrl.pathname);
			if (!VALID_EXTENSIONS.includes(ext)) {
				return this.errorReply('Image must have .jpg, .png, or .gif extension.');
			}

			try {
				Config.customavatars = Config.customavatars || {};
				Config.customavatars[userId] = userId + ext;

				const { resized } = await downloadAndValidateImage(parsedUrl.href, userId, ext);
				const avatarUrl = `${AVATAR_BASE_URL}${userId}${ext}?ts=${Date.now()}`;

				let note = '';
				if (!SHARP_AVAILABLE) {
					note = ' ⚠️ Sharp not installed, avatar saved without resizing.';
				} else if (resized) {
					note = ' (auto-resized with aspect ratio preserved)';
				} else {
					note = ' (already 80x80, no resize needed)';
				}

				this.sendReplyBox(
					`✅ <b>${name}'s avatar was successfully set.</b><br />` +
					`Stored locally as: <code>${userId + ext}</code><br />` +
					`<img src='${avatarUrl}' width='80' height='80'>${note}`
				);

				const targetUser = Users.get(userId);
				if (targetUser) {
					targetUser.popup(
						`|html|${Impulse.nameColor(user.name, true, true)} set your custom avatar.<br />` +
						`<center><img src='${avatarUrl}' width='80' height='80'></center>`
					);
				}

				this.parse(`/personalavatar ${userId},${Config.customavatars[userId]}`);

				const staffRoom = Rooms.get(STAFF_ROOM_ID);
				if (staffRoom) {
					staffRoom.add(
						`|html|<div class="infobox">` +
						`${Impulse.nameColor(user.name, true, true)} set custom avatar for ` +
						`${Impulse.nameColor(name, true, false)}: ` +
						`<img src='${avatarUrl}' width='80' height='80'>${note}` +
						`</div>`
					).update();
				}
			} catch (err: any) {
				this.errorReply(`❌ Failed to set avatar for ${name}: ${err.message}`);
				console.error('Error setting avatar:', err);
			}
		},

		async delete(this: CommandContext, target: string) {
			this.checkCan('bypassall');
			const userId = toID(target);
			const image = Config.customavatars?.[userId];
			if (!image) {
				return this.errorReply(`${target} does not have a custom avatar.`);
			}
			if (Config.customavatars) delete Config.customavatars[userId];
			try {
				await FS(AVATAR_PATH + image).unlinkIfExists();

				const targetUser = Users.get(userId);
				if (targetUser) {
					// Bust cache when showing deletion message
					const avatarUrl = `${AVATAR_BASE_URL}${image}?ts=${Date.now()}`;
					targetUser.popup(
						`|html|${Impulse.nameColor(this.user.name, true, true)} has deleted your custom avatar.<br />` +
						`<center><img src='${avatarUrl}' width='80' height='80' style="opacity:0.3;filter:grayscale(100%);"></center>`
					);
				}
				this.sendReply(`✅ ${target}'s avatar has been removed.`);

				const staffRoom = Rooms.get(STAFF_ROOM_ID);
				if (staffRoom) {
					staffRoom.add(
						`|html|<div class="infobox">` +
						`${Impulse.nameColor(this.user.name, true, true)} deleted custom avatar for ` +
						`${Impulse.nameColor(target, true, false)}.` +
						`</div>`
					).update();
				}
				this.parse(`/removeavatar ${userId}`);
			} catch (err) {
				this.errorReply(`❌ Failed to delete avatar for ${target}.`);
				console.error('Error deleting avatar:', err);
			}
		},

		list(this: CommandContext) {
			this.checkCan('bypassall');
			const avatars = Config.customavatars || {};
			const keys = Object.keys(avatars).sort();
			if (!keys.length) {
				return this.sendReplyBox('ℹ️ <b>No custom avatars are currently set.</b>');
			}
			let html = `<details><summary><b>Current Custom Avatars (${keys.length})</b></summary>`;
			html += `<div style="max-height:320px;overflow:auto;margin-top:5px;"><table border="1" cellspacing="0" cellpadding="4"><tr><th>User</th><th>Avatar</th></tr>`;
			for (const userid of keys) {
				const file = avatars[userid];
				const url = `${AVATAR_BASE_URL}${file}?ts=${Date.now()}`;
				html += `<tr><td>${userid}</td><td><img src="${url}" width="80" height="80"></td></tr>`;
			}
			html += `</table></div></details>`;
			this.sendReplyBox(html);
		},

		''(target, room, user) {
			this.parse('/customavatarhelp');
		},
	},

	customavatarhelp(target: string, room: ChatRoom | null, user: User) {
		if (!this.runBroadcast()) return;
		this.sendReplyBox(
			`<b>Custom Avatar Commands:</b><br>` +
			`• <code>/customavatar set [username], [https-image-url]</code> - Sets a user's avatar (Requires ~). Must be HTTPS. Auto-resizes to 80x80 (if Sharp is installed).<br>` +
			`• <code>/customavatar delete [username]</code> - Removes a user's avatar (Requires ~)<br>` +
			`• <code>/customavatar list</code> - Lists all custom avatars (Requires ~)`
		);
	},
};
