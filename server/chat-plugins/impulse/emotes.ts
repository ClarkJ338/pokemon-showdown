/***************************************
* Impulse Showdown Emotes System       *
* Credits: TurboRx                     *
***************************************/

import { FS } from '../../../lib';

// ================ Configuration ================
const EMOTES_FILE_PATH = 'databases/emotes.json';
const EMOTE_LOGS_PATH = 'databases/emote-logs.json';
const STAFF_ROOM_ID = 'staff';
const MAX_EMOTE_SIZE = '50px'; // Default max size for emotes
const EMOTE_COOLDOWN = 3000; // 3 second cooldown per user

// ================ Helper Functions ================
function formatUTCTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return /\.(png|jpg|jpeg|gif|webp)$/i.test(url);
  } catch {
    return false;
  }
}

// ================ Interfaces ================
interface Emote {
  name: string;
  url: string;
  addedBy: string;
  addedAt: number;
  width?: string;
  height?: string;
}

interface EmotesData {
  [emoteName: string]: Emote;
}

interface EmoteLogEntry {
  timestamp: number;
  action: 'add' | 'delete' | 'use' | 'modify';
  emoteName: string;
  userId: string;
  by?: string;
  details?: any;
}

interface EmoteLogs {
  logs: EmoteLogEntry[];
}

interface EmoteCooldowns {
  [userid: string]: number;
}

// ================ Emotes Class ================
export class EmotesSystem {
  private static data: EmotesData = EmotesSystem.loadEmotesData();
  private static logs: EmoteLogs = EmotesSystem.loadEmoteLogs();
  private static cooldowns: EmoteCooldowns = {};

  // Data Loading & Saving Methods
  private static loadEmotesData(): EmotesData {
    try {
      const rawData = FS(EMOTES_FILE_PATH).readIfExistsSync();
      return rawData ? (JSON.parse(rawData) as EmotesData) : {};
    } catch (error) {
      console.error(`Error reading emotes data: ${error}`);
      return {};
    }
  }

  private static saveEmotesData(): void {
    try {
      FS(EMOTES_FILE_PATH).writeUpdate(() => JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error(`Error saving emotes data: ${error}`);
    }
  }

  private static loadEmoteLogs(): EmoteLogs {
    try {
      const rawData = FS(EMOTE_LOGS_PATH).readIfExistsSync();
      return rawData ? (JSON.parse(rawData) as EmoteLogs) : { logs: [] };
    } catch (error) {
      console.error(`Error reading emote logs: ${error}`);
      return { logs: [] };
    }
  }

  private static saveEmoteLogs(): void {
    try {
      FS(EMOTE_LOGS_PATH).writeUpdate(() => JSON.stringify(this.logs, null, 2));
    } catch (error) {
      console.error(`Error saving emote logs: ${error}`);
    }
  }

  private static logAction(entry: Omit<EmoteLogEntry, 'timestamp'>): void {
    this.logs.logs.push({ timestamp: Date.now(), ...entry });
    // Keep only last 1000 logs
    if (this.logs.logs.length > 1000) {
      this.logs.logs = this.logs.logs.slice(-1000);
    }
    this.saveEmoteLogs();
  }

  // Cooldown Management
  private static isOnCooldown(userid: string): boolean {
    const lastUse = this.cooldowns[userid] || 0;
    return Date.now() - lastUse < EMOTE_COOLDOWN;
  }

  private static updateCooldown(userid: string): void {
    this.cooldowns[userid] = Date.now();
  }

  // Core Emotes Functions
  static addEmote(name: string, url: string, addedBy: string, width?: string, height?: string): string {
    const emoteName = name.toLowerCase();
    
    if (!/^[a-zA-Z0-9_]+$/.test(emoteName)) {
      return "Emote names can only contain letters, numbers, and underscores.";
    }
    
    if (emoteName.length > 20) {
      return "Emote names cannot be longer than 20 characters.";
    }
    
    if (!isValidUrl(url)) {
      return "Invalid image URL. Must be a valid URL ending in .png, .jpg, .jpeg, .gif, or .webp";
    }
    
    if (this.data[emoteName]) {
      return `Emote \"${emoteName}\" already exists. Use /deleteemote to remove it first.`;
    }

    this.data[emoteName] = {
      name: emoteName,
      url,
      addedBy,
      addedAt: Date.now(),
      width: width || MAX_EMOTE_SIZE,
      height: height || MAX_EMOTE_SIZE,
    };

    this.saveEmotesData();
    this.logAction({ 
      action: 'add', 
      emoteName, 
      userId: addedBy,
      details: { url, width, height }
    });

    return `Emote \"${emoteName}\" has been added successfully!`;
  }

  static deleteEmote(name: string, deletedBy: string): string {
    const emoteName = name.toLowerCase();
    
    if (!this.data[emoteName]) {
      return `Emote \"${emoteName}\" does not exist.`;
    }

    const emote = this.data[emoteName];
    delete this.data[emoteName];
    this.saveEmotesData();
    this.logAction({ 
      action: 'delete', 
      emoteName, 
      userId: deletedBy,
      details: { originalUrl: emote.url }
    });

    return `Emote \"${emoteName}\" has been deleted successfully!`;
  }

  static getEmote(name: string): Emote | null {
    return this.data[name.toLowerCase()] || null;
  }

  static getAllEmotes(): Emote[] {
    return Object.values(this.data).sort((a, b) => a.name.localeCompare(b.name));
  }

  static useEmote(name: string, userid: string): string | null {
    const emoteName = name.toLowerCase();
    const emote = this.data[emoteName];
    
    if (!emote) {
      return null; // Emote doesn't exist
    }

    if (this.isOnCooldown(userid)) {
      return 'cooldown'; // User is on cooldown
    }

    this.updateCooldown(userid);
    this.logAction({ 
      action: 'use', 
      emoteName, 
      userId: userid 
    });

    return `<img src=\"${emote.url}\" alt=\"${emote.name}\" title=\"${emote.name}\" style=\"max-width: ${emote.width}; max-height: ${emote.height}; vertical-align: middle;\">`;
  }

  // Search and filter functions
  static searchEmotes(query: string): Emote[] {
    const searchTerm = query.toLowerCase();
    return Object.values(this.data).filter(emote => 
      emote.name.includes(searchTerm)
    ).sort((a, b) => a.name.localeCompare(b.name));
  }

  static getEmotesByUser(userid: string): Emote[] {
    return Object.values(this.data).filter(emote => 
      emote.addedBy === userid
    ).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Logs
  static getLogs(emoteName?: string, page: number = 1, entriesPerPage: number = 50): EmoteLogEntry[] {
    let filteredLogs = this.logs.logs;
    if (emoteName) {
      filteredLogs = filteredLogs.filter(log => log.emoteName === emoteName.toLowerCase());
    }
    const reversedLogs = [...filteredLogs].reverse();
    const startIndex = (page - 1) * entriesPerPage;
    const endIndex = startIndex + entriesPerPage;
    return reversedLogs.slice(startIndex, endIndex);
  }
}

// Attach to global Impulse object
global.EmotesSystem = EmotesSystem;

// ================ Chat Message Parser ================
// This function should be called from the main chat parser to replace emotes in messages
export function parseEmotes(message: string, userid: string): string {
  // Match emote patterns like :emotename:
  return message.replace(/:([a-zA-Z0-9_]+):/g, (match, emoteName) => {
    const result = EmotesSystem.useEmote(emoteName, userid);
    if (result === null) {
      return match; // Emote doesn't exist, return original
    } else if (result === 'cooldown') {
      return match; // User on cooldown, return original
    } else {
      return result; // Return the emote HTML
    }
  });
}

// ================ Pages ================
export const pages: Chat.PageTable = {
  emotes(args, user) {
    const [searchQuery] = args;
    const emotes = searchQuery ? 
      EmotesSystem.searchEmotes(searchQuery) : 
      EmotesSystem.getAllEmotes();
    
    let output = `<div class="pad">`;
    
    // Header with timestamp and user info
    output += `<div class="infobox">` +
      `<strong>Current Date and Time (UTC):</strong> ${formatUTCTimestamp(new Date())}<br>` +
      `<strong>Current User:</strong> ${Impulse.nameColor(user.id, true, true)}` +
      `</div><br>`;

    // Search and refresh controls
    output += `<div style="margin-bottom: 10px;">` +
      `<input type="text" placeholder="Search emotes..." id="emote-search" style="padding: 5px; margin-right: 10px;">` +
      `<button class="button" onclick="window.location='/view-emotes-' + document.getElementById('emote-search').value">Search</button> ` +
      `<button class="button" name="send" value="/join view-emotes">` +
      `<i class="fa fa-refresh"></i> Refresh</button>` +
      `</div>`;

    if (!emotes.length) {
      output += `<h2>No emotes found${searchQuery ? ` for "${searchQuery}"` : ''}.</h2>`;
    } else {
      output += `<h2>Available Emotes ${searchQuery ? `(Search: "${searchQuery}")` : ''}</h2>`;
      output += `<p>Use emotes in chat by typing <code>:emotename:</code></p>`;
      
      // Grid layout for emotes
      output += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">`;
      
      emotes.forEach(emote => {
        const addedDate = formatUTCTimestamp(new Date(emote.addedAt));
        output += `<div class="infobox" style="text-align: center; padding: 10px;">` +
          `<div style="margin-bottom: 8px;">` +
          `<img src="${emote.url}" alt="${emote.name}" title="${emote.name}" ` +
          `style="max-width: ${emote.width}; max-height: ${emote.height}; border: 1px solid #ccc;">` +
          `</div>` +
          `<div style="font-weight: bold; margin-bottom: 4px;">:${emote.name}:</div>` +
          `<div style="font-size: 0.8em; color: #666;">` +
          `Added by: ${Impulse.nameColor(emote.addedBy, true, true)}<br>` +
          `Date: ${addedDate}` +
          `</div>` +
          `</div>`;
      });
      
      output += `</div>`;
    }

    output += `<br><div style="text-align: center; margin-top: 20px;">` +
      `<p>Total emotes: <strong>${EmotesSystem.getAllEmotes().length}</strong></p>` +
      `</div></div>`;

    return output;
  },

  emotelogs(args, user) {
    if (!user.can('bypassall')) {
      return `<div class="pad"><h2>Access denied.</h2></div>`;
    }

    const [emoteName, pageStr] = args;
    const page = parseInt(pageStr) || 1;
    const logs = EmotesSystem.getLogs(emoteName, page);

    if (!logs.length) {
      return `<div class="pad"><h2>No emote logs found${emoteName ? ` for "${emoteName}"` : ''}.</h2></div>`;
    }

    const title = `Emote Logs${emoteName ? ` for "${emoteName}"` : ''} (Page ${page})`;
    const header = ['Time (UTC)', 'Action', 'Emote', 'User', 'Details'];
    const data = logs.map(log => {
      const timestamp = formatUTCTimestamp(new Date(log.timestamp));
      const details = log.details ? JSON.stringify(log.details) : '-';
      return [
        timestamp,
        log.action.toUpperCase(),
        log.emoteName,
        Impulse.nameColor(log.userId, true, true),
        details
      ];
    });

    const tableHTML = Impulse.generateThemedTable(title, header, data);
    
    return `<div class="pad">` +
      `<div style="float: right">` +
      `<button class="button" name="send" value="/emotelogs ${emoteName || ''}, ${page}">` +
      `<i class="fa fa-refresh"></i> Refresh</button>` +
      `</div>` +
      `<div style="clear: both"></div>` +
      `<div class="ladder">${tableHTML}</div>` +
      `</div>`;
  },
};

// ================ Chat Commands ================
export const commands: Chat.Commands = {
  // User Commands
  emotes(target, room, user) {
    if (!this.runBroadcast()) return;
    const searchQuery = target ? target.trim() : '';
    return this.parse(`/join view-emotes${searchQuery ? '-' + searchQuery : ''}`);
  },

  emote(target, room, user) {
    if (!target) return this.errorReply("Usage: /emote [emote name]");
    
    const result = EmotesSystem.useEmote(target, user.id);
    if (result === null) {
      return this.errorReply(`Emote "${target}" does not exist. Use /emotes to see available emotes.`);
    } else if (result === 'cooldown') {
      return this.errorReply("You're using emotes too quickly! Please wait a moment.");
    } else {
      if (room) {
        room.add(`|html|<div style="margin: 2px 0;">${Impulse.nameColor(user.name, true, true)}: ${result}</div>`);
        room.update();
      }
    }
  },

  // Admin Commands
  addemote(target, room, user) {
    this.checkCan('bypassall');
    if (!target) return this.sendReply("Usage: /addemote [name], [image url], [optional: width], [optional: height]");
    
    const parts = target.split(',').map(p => p.trim());
    if (parts.length < 2) return this.sendReply("Usage: /addemote [name], [image url], [optional: width], [optional: height]");

    const [name, url, width, height] = parts;
    const result = EmotesSystem.addEmote(name, url, user.id, width, height);
    
    this.sendReply(result);
    this.modlog('ADDEMOTE', null, name, { by: user.id, url });
    
    if (result.includes('successfully')) {
      // Notify staff room
      const staffRoom = Rooms.get(STAFF_ROOM_ID);
      if (staffRoom) {
        staffRoom.add(
          `|html|<div class="infobox">${Impulse.nameColor(user.name, true, true)} ` +
          `added emote "${name}": <img src="${url}" style="max-width: 30px; max-height: 30px;"></div>`
        ).update();
      }
    }
  },

  deleteemote(target, room, user) {
    this.checkCan('bypassall');
    if (!target) return this.sendReply("Usage: /deleteemote [emote name]");
    
    const result = EmotesSystem.deleteEmote(target, user.id);
    this.sendReply(result);
    this.modlog('DELETEEMOTE', null, target, { by: user.id });
    
    if (result.includes('successfully')) {
      // Notify staff room
      const staffRoom = Rooms.get(STAFF_ROOM_ID);
      if (staffRoom) {
        staffRoom.add(
          `|html|<div class="infobox">${Impulse.nameColor(user.name, true, true)} ` +
          `deleted emote "${target}"</div>`
        ).update();
      }
    }
  },

  emoteinfo(target, room, user) {
    if (!target) return this.sendReply("Usage: /emoteinfo [emote name]");
    
    const emote = EmotesSystem.getEmote(target);
    if (!emote) {
      return this.errorReply(`Emote "${target}" does not exist.`);
    }
    
    const addedDate = formatUTCTimestamp(new Date(emote.addedAt));
    this.sendReplyBox(
      `<div style="text-align: center;">` +
      `<h3>Emote Information</h3>` +
      `<div style="margin: 10px 0;">` +
      `<img src="${emote.url}" alt="${emote.name}" style="max-width: ${emote.width}; max-height: ${emote.height}; border: 1px solid #ccc;">` +
      `</div>` +
      `<div><strong>Name:</strong> :${emote.name}:</div>` +
      `<div><strong>Added by:</strong> ${Impulse.nameColor(emote.addedBy, true, true)}</div>` +
      `<div><strong>Added on:</strong> ${addedDate}</div>` +
      `<div><strong>Size:</strong> ${emote.width} x ${emote.height}</div>` +
      `<div><strong>URL:</strong> <a href="${emote.url}" target="_blank">${emote.url}</a></div>` +
      `</div>`
    );
  },

  myemotes(target, room, user) {
    if (!this.runBroadcast()) return;
    
    const userEmotes = EmotesSystem.getEmotesByUser(user.id);
    if (!userEmotes.length) {
      return this.sendReplyBox("You haven't added any emotes yet.");
    }
    
    const emotesHtml = userEmotes.map(emote => 
      `<span style="display: inline-block; margin: 5px; text-align: center;">` +
      `<img src="${emote.url}" alt="${emote.name}" style="max-width: 32px; max-height: 32px; display: block;">` +
      `<small>:${emote.name}:</small>` +
      `</span>`
    ).join('');
    
    this.sendReplyBox(
      `<div>` +
      `<h3>Your Emotes (${userEmotes.length})</h3>` +
      `<div style="max-height: 200px; overflow-y: auto;">${emotesHtml}</div>` +
      `</div>`
    );
  },

  emotelogs(target, room, user) {
    this.checkCan('bypassall');
    if (!this.runBroadcast()) return;
    
    const parts = target.split(',').map(p => p.trim());
    const emoteName = parts[0] || '';
    const page = parseInt(parts[1]) || 1;
    
    return this.parse(`/join view-emotelogs${emoteName ? '-' + emoteName : ''}-${page}`);
  },

  emotehelp(target, room, user) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<details><summary><b><center>Emotes System Commands By ${Impulse.nameColor('TurboRx', true, true)}</center></b></summary>` +
      `<b>User Commands:</b><br>` +
      `<ul>` +
      `<li><code>/emotes [search]</code> - View all available emotes or search for specific ones</li>` +
      `<li><code>/emote [name]</code> - Use an emote in chat (or just type :emotename: in your message)</li>` +
      `<li><code>/emoteinfo [name]</code> - Get detailed information about a specific emote</li>` +
      `<li><code>/myemotes</code> - View emotes you've added</li>` +
      `</ul><br>` +
      `<b>Admin Commands</b> (Requires: @ and higher):<br>` +
      `<ul>` +
      `<li><code>/addemote [name], [url], [width], [height]</code> - Add a new emote (width/height optional)</li>` +
      `<li><code>/deleteemote [name]</code> - Remove an emote</li>` +
      `<li><code>/emotelogs [emote], [page]</code> - View emote usage and management logs</li>` +
      `</ul><br>` +
      `<b>Usage:</b><br>` +
      `Type <code>:emotename:</code> in your chat messages to use emotes!<br>` +
      `Example: <code>Hello :smile: how are you?</code>` +
      `</details>`
    );
  },
};

/*
TO INTEGRATE WITH CHAT:
Add this to your main chat parsing function in server/chat.ts:

// In the parse function, after "// Output the message" section:
if (this.user.registered && message.includes(':')) {
  message = require('./impulse-plugins/emotes').parseEmotes(message, this.user.id);
}

This will automatically replace :emotename: patterns with the actual emote images in chat messages.
*/
