/******************************************
* Pokemon Showdown Custom Icon Commands   *
* Original Code By: Lord Haji, Panpawn    *
* Updated To Typescript By: Prince Sky    *
* Improved for Validation, Security,      *
* Error Handling, and Readability         *
* Improvements By: TurboRx                *
*******************************************/


import { FS } from '../lib/fs';

// Change this to match your server's userlist color.
const backgroundColor = 'rgba(248, 187, 217, 0.3)';
const STAFF_ROOM_ID = 'staff';

interface Icons {
	[userid: string]: string;
}

let icons: Icons = {};

try {
	const iconsData = FS('impulse-db/usericons.json').readIfExistsSync();
	if (iconsData) {
		const parsedData = JSON.parse(iconsData);
		// Basic validation of loaded JSON structure
		if (typeof parsedData === 'object' && parsedData !== null) {
			for (const key in parsedData) {
				if (typeof key !== 'string' || typeof parsedData[key] !== 'string') {
					throw new Error('Invalid icon data format');
				}
			}
			icons = parsedData;
		} else {
			throw new Error('Invalid icon data structure');
		}
	}
} catch (err) {
	console.error(`Failed to parse or validate usericons.json:`, err);
}

function isValidImageUrl(url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		return /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(parsedUrl.pathname);
	} catch {
		return false;
	}
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	}[char] ?? char));
}

/**
 * Updates the icons JSON file and regenerates the CSS for user icons
 */
async function updateIcons(): Promise<void> {
	try {
		await FS('impulse-db/usericons.json').writeUpdate(() => JSON.stringify(icons));
		let newCss = '/* ICONS START */\n';
		for (const name in icons) {
			const safeUrl = escapeHtml(icons[name]);
			newCss += `[id$="-userlist-user-${toID(name)}"] { background: ${backgroundColor} url("${safeUrl}") right no-repeat !important; background-size: 21px!important;}\n`;
		}
		newCss += '/* ICONS END */\n';

		const file = FS('config/custom.css').readIfExistsSync()?.split('\n') ?? [];
		const start = file.indexOf('/* ICONS START */');
		const end = file.indexOf('/* ICONS END */');
		if (start !== -1 && end !== -1) {
			file.splice(start, (end - start) + 1);
		}
		await FS('config/custom.css').writeUpdate(() => file.join('\n') + newCss);

		if (typeof Impulse !== 'undefined' && typeof Impulse.reloadCSS === 'function') {
			Impulse.reloadCSS();
		}
	} catch (err) {
		console.error('Error updating icons:', err);
	}
}

export const commands: Chat.ChatCommands = {
	usericon: 'icon',
	icon: {
		async set(this: CommandContext, target: string, room: Room, user: User) {
			this.checkCan('ban');
			const [name, imageUrl] = target.split(',').map(s => s.trim());
			if (!name || !imageUrl) return this.parse('/help icon');

			const userId = toID(name);
			if (userId.length > 19) return this.errorReply('Usernames are not this long...');
			if (icons[userId]) return this.errorReply('This user already has an icon. Remove it first with /icon delete [user].');

			if (!isValidImageUrl(imageUrl)) {
				return this.errorReply('Invalid image URL. Must end with an image extension like jpg, png, gif, etc.');
			}

			icons[userId] = imageUrl;
			await updateIcons();

			this.sendReply(`|raw|You have given ${Impulse?.nameColor ? Impulse.nameColor(name, true, false) : name} an icon.`);

			const targetUser = Users.get(userId);
			if (targetUser?.connected) {
				const safeUserName = escapeHtml(user.name);
				targetUser.popup(`|html|${Impulse?.nameColor ? Impulse.nameColor(safeUserName, true, true) : safeUserName} has set your userlist icon to: <img src="${escapeHtml(imageUrl)}" width="32" height="32"><br /><center>Refresh, If you don't see it.</center>`);
			}

			const staffRoom = Rooms.get(STAFF_ROOM_ID);
			if (staffRoom) {
				staffRoom.add(`|html|<div class="infobox">${Impulse?.nameColor ? Impulse.nameColor(user.name, true, true) : escapeHtml(user.name)} set icon for ${Impulse?.nameColor ? Impulse.nameColor(name, true, false) : escapeHtml(name)}: <img src="${escapeHtml(imageUrl)}" width="32" height="32"></div>`).update();
			}
		},

		async delete(this: CommandContext, target: string, room: Room, user: User) {
			this.checkCan('ban');

			const userId = toID(target);
			if (!icons[userId]) return this.errorReply(`${target} does not have an icon.`);

			delete icons[userId];
			await updateIcons();

			this.sendReply(`You removed ${target}'s icon.`);

			const targetUser = Users.get(userId);
			if (targetUser?.connected) {
				const safeUserName = escapeHtml(user.name);
				targetUser.popup(`|html|${Impulse?.nameColor ? Impulse.nameColor(safeUserName, true, true) : safeUserName} has removed your userlist icon.`);
			}

			const staffRoom = Rooms.get(STAFF_ROOM_ID);
			if (staffRoom) {
				staffRoom.add(`|html|<div class="infobox">${Impulse?.nameColor ? Impulse.nameColor(user.name, true, true) : escapeHtml(user.name)} removed icon for ${Impulse?.nameColor ? Impulse.nameColor(target, true, false) : escapeHtml(target)}.</div>`).update();
			}
		},

		''(target, room, user) {
			this.parse('/iconhelp');
		},
	},

	iconhelp(target: string, room: ChatRoom | null, user: User) {
		if (!this.runBroadcast()) return;
		this.sendReplyBox(
			`<b>Custom Icon Commands:</b><br>` +
			`• <code>/icon set [username], [image url]</code> - Gives [user] an icon (Requires: @ and higher)<br>` +
			`• <code>/icon delete [username]</code> - Removes a user's icon (Requires: @ and higher)`
		);
	},
};
