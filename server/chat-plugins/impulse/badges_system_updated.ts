/**
 * @author mia-pi-git
 * Custom badges system for displaying user badges
 */

import { FS } from '../../../lib';

interface Badge {
	id: string;
	name: string;
	imageUrl: string;
}

interface BadgeData {
	badgeholders: { [userid: string]: string[] }; // userid -> array of badge IDs
	displaySettings: { [userid: string]: string[] }; // userid -> array of up to 5 badge IDs to display
	badgesList: Badge[]; // Store badges list in data
	lastUpdated: number;
}

// Internal badges list - dynamically managed
export let BADGES_LIST: Badge[] = [
	{
		id: 'champion',
		name: 'Tournament Champion',
		imageUrl: 'https://raw.githubusercontent.com/msikma/pokesprite/master/misc/ribbon/battle-memory-ribbon-gold.png'
	},
	{
		id: 'veteran',
		name: 'Veteran Player',
		imageUrl: 'https://raw.githubusercontent.com/msikma/pokesprite/master/misc/ribbon/battle-royal-master-ribbon.png'
	},
];

// Helper function to get badge by ID
export function getBadgeById(badgeId: string): Badge | undefined {
	return BADGES_LIST.find(badge => badge.id === badgeId);
}

// Helper function to validate badge ID exists
export function isValidBadgeId(badgeId: string): boolean {
	return BADGES_LIST.some(badge => badge.id === badgeId);
}

export let data: BadgeData;

try {
	data = JSON.parse(FS('databases/badges.json').readSync());
	// Ensure displaySettings exists for backwards compatibility
	if (!data.displaySettings) {
		data.displaySettings = {};
	}
	// Load badges list from data or use default
	if (data.badgesList && Array.isArray(data.badgesList)) {
		BADGES_LIST = data.badgesList;
	} else {
		// If no badges list in data, save the default one
		data.badgesList = BADGES_LIST;
		saveData();
	}
} catch {
	data = {
		badgeholders: {},
		displaySettings: {},
		badgesList: BADGES_LIST,
		lastUpdated: 0,
	};
	saveData();
}

export function getBadges(user: User): string[] {
	return data.badgeholders[user.id] || [];
}

export function getDisplayBadges(user: User): string[] {
	const userBadges = getBadges(user);
	const displaySettings = data.displaySettings[user.id];
	
	// If user has display settings, validate they still own those badges
	if (displaySettings) {
		const validDisplayBadges = displaySettings.filter(badgeId => userBadges.includes(badgeId));
		return validDisplayBadges;
	}
	
	// If no display settings or user has <= 5 badges, return all badges (up to 5)
	return userBadges.slice(0, 5);
}

export function addBadge(userid: string, badgeId: string) {
	// Validate that the badge ID exists in our badges list
	if (!isValidBadgeId(badgeId)) {
		return { success: false, error: `Invalid badge ID: ${badgeId}` };
	}
	
	if (!data.badgeholders[userid]) {
		data.badgeholders[userid] = [];
	}
	if (!data.badgeholders[userid].includes(badgeId)) {
		data.badgeholders[userid].push(badgeId);
		data.lastUpdated = Date.now();
		saveData();
		return { success: true };
	}
	return { success: false, error: `User already has badge: ${badgeId}` };
}

export function AddRewardBadge(userid: string, badgeId: string, reason?: string, silent = false) {
	// Validate that the badge ID exists in our badges list
	if (!isValidBadgeId(badgeId)) {
		return { 
			success: false, 
			error: `Invalid badge ID: ${badgeId}`,
			awarded: false
		};
	}
	
	const targetUser = toID(userid);
	const badge = getBadgeById(badgeId);
	
	if (!data.badgeholders[targetUser]) {
		data.badgeholders[targetUser] = [];
	}
	
	// Check if user already has the badge
	if (data.badgeholders[targetUser].includes(badgeId)) {
		return { 
			success: true, 
			error: `User already has badge: ${badge?.name || badgeId}`,
			awarded: false,
			badge
		};
	}
	
	// Award the badge
	data.badgeholders[targetUser].push(badgeId);
	data.lastUpdated = Date.now();
	saveData();
	
	// Try to notify the user if they're online and not in silent mode
	if (!silent) {
		const user = Users.get(targetUser);
		if (user && user.connected) {
			const reasonText = reason ? ` for ${reason}` : '';
			user.popup(`|html|<div class="broadcast-green"><strong>Congratulations!</strong><br />You have been awarded the badge: <strong>${badge?.name || badgeId}</strong>${reasonText}!</div>`);
		}
	}
	
	return { 
		success: true, 
		awarded: true,
		badge,
		message: `Successfully awarded badge "${badge?.name || badgeId}" to ${targetUser}${reason ? ` for ${reason}` : ''}`
	};
}

// Batch reward function for multiple users
export function AddRewardBadgeToMultiple(userids: string[], badgeId: string, reason?: string, silent = false) {
	const results = {
		success: true,
		awarded: 0,
		alreadyHad: 0,
		errors: [] as string[],
		badge: getBadgeById(badgeId)
	};
	
	if (!isValidBadgeId(badgeId)) {
		results.success = false;
		results.errors.push(`Invalid badge ID: ${badgeId}`);
		return results;
	}
	
	for (const userid of userids) {
		const result = AddRewardBadge(userid, badgeId, reason, silent);
		if (result.success && result.awarded) {
			results.awarded++;
		} else if (result.success && !result.awarded) {
			results.alreadyHad++;
		} else {
			results.errors.push(`${userid}: ${result.error}`);
		}
	}
	
	return results;
}

// Helper function to check if user has specific badge (useful for other systems)
export function hasUserBadge(userid: string, badgeId: string): boolean {
	const userBadges = getBadges(Users.get(userid) || { id: toID(userid) } as User);
	return userBadges.includes(badgeId);
}

// Helper function to get badge requirements/info for external systems
export function getBadgeRequirements(badgeId: string) {
	const badge = getBadgeById(badgeId);
	if (!badge) return null;
	
	// This can be extended to include requirements, rarity, etc.
	return {
		...badge,
		exists: true,
		currentHolders: Object.keys(data.badgeholders).filter(userid => 
			data.badgeholders[userid].includes(badgeId)
		).length
	};
}

export function removeBadge(userid: string, badgeId: string) {
	if (!data.badgeholders[userid]) return false;
	const index = data.badgeholders[userid].indexOf(badgeId);
	if (index > -1) {
		data.badgeholders[userid].splice(index, 1);
		if (data.badgeholders[userid].length === 0) {
			delete data.badgeholders[userid];
		}
		
		// Also remove from display settings if it was there
		if (data.displaySettings[userid]) {
			const displayIndex = data.displaySettings[userid].indexOf(badgeId);
			if (displayIndex > -1) {
				data.displaySettings[userid].splice(displayIndex, 1);
				if (data.displaySettings[userid].length === 0) {
					delete data.displaySettings[userid];
				}
			}
		}
		
		data.lastUpdated = Date.now();
		saveData();
		return true;
	}
	return false;
}

export function setDisplayBadges(userid: string, badgeIds: string[]) {
	const userBadges = data.badgeholders[userid] || [];
	
	// Validate that user owns all the badges they want to display
	const validBadges = badgeIds.filter(badgeId => userBadges.includes(badgeId));
	
	// Limit to 5 badges
	if (validBadges.length > 5) {
		validBadges.splice(5);
	}
	
	if (validBadges.length === 0) {
		delete data.displaySettings[userid];
	} else {
		data.displaySettings[userid] = validBadges;
	}
	
	data.lastUpdated = Date.now();
	saveData();
	return validBadges;
}

export function addNewBadge(id: string, name: string, imageUrl: string) {
	// Validate ID format (alphanumeric and underscores only)
	if (!/^[a-zA-Z0-9_]+$/.test(id)) {
		return { success: false, error: 'Badge ID can only contain letters, numbers, and underscores' };
	}
	
	// Check if badge ID already exists
	if (isValidBadgeId(id)) {
		return { success: false, error: `Badge with ID "${id}" already exists` };
	}
	
	// Validate required fields
	if (!id.trim() || !name.trim() || !imageUrl.trim()) {
		return { success: false, error: 'All fields (ID, name, imageUrl) are required' };
	}
	
	// Add badge to list
	const newBadge: Badge = { id: id.toLowerCase(), name: name.trim(), imageUrl: imageUrl.trim() };
	BADGES_LIST.push(newBadge);
	data.badgesList = BADGES_LIST;
	data.lastUpdated = Date.now();
	saveData();
	
	return { success: true, badge: newBadge };
}

export function removeBadgeDefinition(badgeId: string) {
	const index = BADGES_LIST.findIndex(badge => badge.id === badgeId);
	if (index === -1) {
		return { success: false, error: `Badge "${badgeId}" not found` };
	}
	
	// Remove badge from definition list
	const removedBadge = BADGES_LIST.splice(index, 1)[0];
	data.badgesList = BADGES_LIST;
	
	// Remove badge from all users who have it
	let removedFromUsers = 0;
	for (const userid in data.badgeholders) {
		if (removeBadge(userid, badgeId)) {
			removedFromUsers++;
		}
	}
	
	data.lastUpdated = Date.now();
	saveData();
	
	return { success: true, badge: removedBadge, removedFromUsers };
}

export function editBadge(badgeId: string, newName?: string, newImageUrl?: string) {
	const badge = getBadgeById(badgeId);
	if (!badge) {
		return { success: false, error: `Badge "${badgeId}" not found` };
	}
	
	if (newName) badge.name = newName.trim();
	if (newImageUrl) badge.imageUrl = newImageUrl.trim();
	
	data.badgesList = BADGES_LIST;
	data.lastUpdated = Date.now();
	saveData();
	
	return { success: true, badge };
}

export function clearBadges(userid: string) {
	if (data.badgeholders[userid]) {
		delete data.badgeholders[userid];
		delete data.displaySettings[userid]; // Also clear display settings
		data.lastUpdated = Date.now();
		saveData();
		return true;
	}
	return false;
}

export function saveData() {
	// Always sync the badges list to data before saving
	data.badgesList = BADGES_LIST;
	FS('databases/badges.json').writeUpdate(() => JSON.stringify(data));
}

export const commands: Chat.ChatCommands = {
	testbadgereward(target, room, user) {
		this.checkCan('ban');
		const parts = target.split(',').map(x => x.trim());
		if (parts.length < 2 || parts.length > 4) {
			return this.errorReply('Usage: /testbadgereward userid, badgeId[, reason][, silent]');
		}
		
		const [userid, badgeId, reason, silentStr] = parts;
		const silent = silentStr === 'true' || silentStr === 'silent';
		
		const result = AddRewardBadge(userid, badgeId, reason, silent);
		if (result.success && result.awarded) {
			this.sendReply(result.message || `Badge awarded successfully.`);
		} else if (result.success && !result.awarded) {
			this.sendReply(result.error || `Badge not awarded (user already has it).`);
		} else {
			this.errorReply(result.error || 'Failed to award badge.');
		}
	},

	addnewbadge(target, room, user) {
		this.checkCan('declare'); // Higher permission level for creating badges
		const parts = target.split(',').map(x => x.trim());
		if (parts.length !== 3) {
			return this.errorReply('Usage: /addnewbadge Name, id, imageUrl');
		}
		const [name, id, imageUrl] = parts;
		
		const result = addNewBadge(id, name, imageUrl);
		if (result.success) {
			this.sendReply(`Successfully created badge "${result.badge?.name}" with ID "${result.badge?.id}".`);
			this.globalModlog('BADGEADD', null, `${user.name} created badge: ${result.badge?.id} - ${result.badge?.name}`);
		} else {
			this.errorReply(result.error || 'Failed to create badge.');
		}
	},

	removebadgedefinition: 'deletebadge',
	deletebadge(target, room, user) {
		this.checkCan('declare');
		if (!target.trim()) {
			return this.errorReply('Usage: /deletebadge badgeId');
		}
		
		const result = removeBadgeDefinition(target.trim());
		if (result.success) {
			this.sendReply(`Successfully deleted badge "${result.badge?.name}" (${result.badge?.id}).`);
			if (result.removedFromUsers > 0) {
				this.sendReply(`Badge was removed from ${result.removedFromUsers} user(s).`);
			}
			this.globalModlog('BADGEDELETE', null, `${user.name} deleted badge: ${result.badge?.id} - ${result.badge?.name}`);
		} else {
			this.errorReply(result.error || 'Failed to delete badge.');
		}
	},

	editbadge(target, room, user) {
		this.checkCan('declare');
		const parts = target.split(',').map(x => x.trim());
		if (parts.length < 2 || parts.length > 3) {
			return this.errorReply('Usage: /editbadge badgeId, newName[, newImageUrl]');
		}
		
		const [badgeId, newName, newImageUrl] = parts;
		const result = editBadge(badgeId, newName, newImageUrl);
		
		if (result.success) {
			this.sendReply(`Successfully updated badge "${result.badge?.name}" (${result.badge?.id}).`);
			this.globalModlog('BADGEEDIT', null, `${user.name} edited badge: ${result.badge?.id}`);
		} else {
			this.errorReply(result.error || 'Failed to edit badge.');
		}
	},

	addbadge(target, room, user) {
		this.checkCan('ban');
		const [userid, badgeId] = target.split(',').map(x => x.trim());
		if (!userid || !badgeId) {
			return this.errorReply('Usage: /addbadge userid, badgeId');
		}
		const targetUser = toID(userid);
		const result = addBadge(targetUser, badgeId);
		if (result.success) {
			const badge = getBadgeById(badgeId);
			this.sendReply(`Added badge "${badge?.name || badgeId}" to user ${targetUser}.`);
		} else {
			this.errorReply(result.error || `Failed to add badge.`);
		}
	},

	removebadge(target, room, user) {
		this.checkCan('ban');
		const [userid, badgeId] = target.split(',').map(x => x.trim());
		if (!userid || !badgeId) {
			return this.errorReply('Usage: /removebadge userid, badgeId');
		}
		const targetUser = toID(userid);
		if (removeBadge(targetUser, badgeId)) {
			const badge = getBadgeById(badgeId);
			this.sendReply(`Removed badge "${badge?.name || badgeId}" from user ${targetUser}.`);
		} else {
			this.errorReply(`User ${targetUser} does not have badge "${badgeId}".`);
		}
	},

	clearbadges: 'clearallbadges',
	clearallbadges(target, room, user) {
		this.checkCan('ban');
		if (!target) {
			return this.errorReply('Usage: /clearallbadges userid');
		}
		const targetUser = toID(target);
		if (clearBadges(targetUser)) {
			this.sendReply(`Cleared all badges for user ${targetUser}.`);
		} else {
			this.errorReply(`User ${targetUser} has no badges to clear.`);
		}
	},

	listbadges(target, room, user) {
		let buf = 'Available badges:\n';
		if (BADGES_LIST.length === 0) {
			buf += 'No badges have been created yet.';
		} else {
			for (const badge of BADGES_LIST) {
				buf += `• ${badge.id}: ${badge.name}\n`;
			}
		}
		if (this.can('declare')) {
			buf += '\nAdmin commands: /addnewbadge, /editbadge, /deletebadge';
		}
		return this.sendReply(buf);
	},

	badgeinfo(target, room, user) {
		if (!target.trim()) {
			return this.errorReply('Usage: /badgeinfo badgeId');
		}
		
		const badge = getBadgeById(target.trim());
		if (!badge) {
			return this.errorReply(`Badge "${target}" not found.`);
		}
		
		let buf = `Badge Information:\n`;
		buf += `ID: ${badge.id}\n`;
		buf += `Name: ${badge.name}\n`;
		buf += `Image URL: ${badge.imageUrl}\n`;
		
		// Count users who have this badge
		let userCount = 0;
		for (const userid in data.badgeholders) {
			if (data.badgeholders[userid].includes(badge.id)) {
				userCount++;
			}
		}
		buf += `Users with this badge: ${userCount}`;
		
		return this.sendReply(buf);
	},

	setdisplaybadges(target, room, user) {
		if (!target) {
			// Show current display settings
			const displayBadges = getDisplayBadges(user);
			const allBadges = getBadges(user);
			
			if (allBadges.length === 0) {
				return this.sendReply('You have no badges.');
			}
			
			let buf = `Your badges: ${allBadges.map(id => {
				const badge = getBadgeById(id);
				return badge ? `${badge.name} (${id})` : id;
			}).join(', ')}\n`;
			buf += `Currently displaying: ${displayBadges.length > 0 ? 
				displayBadges.map(id => {
					const badge = getBadgeById(id);
					return badge ? `${badge.name} (${id})` : id;
				}).join(', ') : 'default (first 5)'}`;
			return this.sendReply(buf);
		}
		
		const badgeIds = target.split(',').map(x => x.trim()).filter(x => x);
		if (badgeIds.length > 5) {
			return this.errorReply('You can only display up to 5 badges.');
		}
		
		const validBadges = setDisplayBadges(user.id, badgeIds);
		if (validBadges.length === 0) {
			this.sendReply('Display settings cleared. You will now display your first 5 badges by default.');
		} else {
			const badgeNames = validBadges.map(id => {
				const badge = getBadgeById(id);
				return badge ? `${badge.name} (${id})` : id;
			}).join(', ');
			this.sendReply(`Display badges set to: ${badgeNames}`);
		}
	},

	mybadges(target, room, user) {
		const allBadges = getBadges(user);
		const displayBadges = getDisplayBadges(user);
		
		if (allBadges.length === 0) {
			return this.sendReply('You have no badges.');
		}
		
		let buf = `Your badges (${allBadges.length}): ${allBadges.map(id => {
			const badge = getBadgeById(id);
			return badge ? `${badge.name} (${id})` : id;
		}).join(', ')}\n`;
		buf += `Currently displaying (${displayBadges.length}): ${displayBadges.length > 0 ? 
			displayBadges.map(id => {
				const badge = getBadgeById(id);
				return badge ? badge.name : id;
			}).join(', ') : 'none'}`;
		
		if (allBadges.length > 5) {
			buf += `\nUse /setdisplaybadges badge1, badge2, badge3, badge4, badge5 to choose which badges to display in battles.`;
		}
		
		return this.sendReply(buf);
	},

	badges(target, room, user) {
		if (target) {
			const targetUser = toID(target);
			const badges = data.badgeholders[targetUser] || [];
			if (badges.length === 0) {
				return this.sendReply(`User ${targetUser} has no badges.`);
			}
			const badgeList = badges.map(id => {
				const badge = getBadgeById(id);
				return badge ? `${badge.name} (${id})` : id;
			}).join(', ');
			return this.sendReply(`${targetUser}'s badges: ${badgeList}`);
		}
		return this.parse(`/join view-badges`);
	},
};

export const pages: Chat.PageTable = {
	badges(query, user) {
		const targetUser = toID(query.shift());
		
		if (targetUser) {
			// Show specific user's badges
			this.title = `[Badges] ${targetUser}`;
			let buf = '<div class="pad">';
			buf += `<h2>Badges for ${targetUser}</h2>`;
			buf += `<small><a target="replace" href="/view-badges">View all users</a></small><br><br>`;
			
			const badges = data.badgeholders[targetUser] || [];
			const displayBadges = data.displaySettings[targetUser] || badges.slice(0, 5);
			
			if (badges.length === 0) {
				buf += `<p>This user has no badges.</p>`;
			} else {
				buf += `<h3>All Badges (${badges.length})</h3>`;
				buf += `<div class="ladder pad">`;
				for (const badgeId of badges) {
					const badge = getBadgeById(badgeId);
					buf += `<div style="display: inline-block; margin: 5px; text-align: center;">`;
					buf += `<img src="${badge?.imageUrl || '/sprites/badges/' + badgeId + '.png'}" alt="${badge?.name || badgeId}" style="width: 32px; height: 32px; display: block;" />`;
					buf += `<small>${badge?.name || badgeId}</small>`;
					buf += `</div>`;
				}
				buf += `</div>`;
				
				if (displayBadges.length > 0 && displayBadges.length !== badges.length) {
					buf += `<h3>Currently Displaying (${displayBadges.length})</h3>`;
					buf += `<div class="ladder pad">`;
					for (const badgeId of displayBadges) {
						const badge = getBadgeById(badgeId);
						buf += `<div style="display: inline-block; margin: 5px; text-align: center;">`;
						buf += `<img src="${badge?.imageUrl || '/sprites/badges/' + badgeId + '.png'}" alt="${badge?.name || badgeId}" style="width: 32px; height: 32px; display: block;" />`;
						buf += `<small>${badge?.name || badgeId}</small>`;
						buf += `</div>`;
					}
					buf += `</div>`;
				}
			}
			buf += `</div>`;
			return buf;
		}
		
		// Show all users with badges
		this.title = `[Badges] All Users`;
		let buf = '<div class="pad">';
		buf += `<h2>All Badge Holders</h2>`;
		buf += `<small>Last updated: ${new Date(data.lastUpdated).toLocaleString()}</small><br><br>`;
		
		const users = Object.keys(data.badgeholders);
		if (users.length === 0) {
			buf += `<p>No users currently have badges.</p>`;
		} else {
			buf += `<div class="ladder pad"><table>`;
			buf += `<tr><th>User</th><th>Total Badges</th><th>Displaying</th></tr>`;
			
			for (const userid of users.sort()) {
				const badges = data.badgeholders[userid];
				const displayBadges = data.displaySettings[userid] || badges.slice(0, 5);
				buf += `<tr>`;
				buf += `<td><a href="/view-badges-${userid}" target="replace">${userid}</a></td>`;
				buf += `<td>${badges.length}</td>`;
				buf += `<td>`;
				for (const badgeId of displayBadges) {
					const badge = getBadgeById(badgeId);
					buf += `<img src="${badge?.imageUrl || '/sprites/badges/' + badgeId + '.png'}" alt="${badge?.name || badgeId}" title="${badge?.name || badgeId}" style="width: 24px; height: 24px; margin-right: 2px;" />`;
				}
				buf += ` (${displayBadges.length})`;
				buf += `</td>`;
				buf += `</tr>`;
			}
			buf += `</table></div>`;
		}
		buf += `</div>`;
		return buf;
	},
};

export const handlers: Chat.Handlers = {
	onBattleStart(user, room) {
		if (!room.battle) return;
		
		// Get user's display badges (up to 5)
		const badges = getDisplayBadges(user);
		if (!badges.length) return;
		
		const slot = room.battle.playerTable[user.id]?.slot;
		if (!slot) return;
		
		// Display up to 5 badges
		for (const [i, badgeId] of badges.entries()) {
			room.add(`|badge|${slot}|${badgeId}|custom|${i}`);
		}
		
		room.update();
	},
};
