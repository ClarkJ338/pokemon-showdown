/******************************************
 * Pokemon Showdown Custom Avatar Commands *
 * Original: CreatePhil & others           *
 * TS Conversion: Prince Sky               *
 ******************************************/

import { FS } from '../../../lib';

const AVATAR_DIR = 'config/avatars/';
const STAFF_ROOM_ID = 'staff';
const VALID_EXTS = ['.jpg', '.png', '.gif'] as const;
type ValidExt = typeof VALID_EXTS[number];

// Extracts the extension from a filename or URL
function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

// Lazily ensures Config.customavatars exists
function ensureAvatarMap(): Record<string, string> {
  Config.customavatars ||= {};
  return Config.customavatars;
}

// Downloads and writes the avatar file
async function saveAvatarFile(url: string, userId: string, ext: ValidExt) {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
      throw new Error(`Invalid image response ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await FS(`${AVATAR_DIR}${userId}${ext}`).write(buf);
  } catch (err) {
    console.error(`Failed to download avatar for ${userId}:`, err);
  }
}

// Deletes the avatar file if it exists
async function removeAvatarFile(filename: string) {
  try {
    await FS(`${AVATAR_DIR}${filename}`).unlinkIfExists();
  } catch (err) {
    console.error(`Failed to delete avatar ${filename}:`, err);
  }
}

// Sends a popup to a user
function popupUser(userId: string, html: string) {
  const target = Users.get(userId);
  if (target?.connected) target.popup(`|html|${html}`);
}

// Logs an infobox message in the staff room
function logStaff(html: string) {
  const staff = Rooms.get(STAFF_ROOM_ID);
  if (staff) staff.add(`|html|<div class="infobox">${html}</div>`).update();
}

// Preload existing avatars into Config.customavatars
(async function loadAvatars() {
  try {
    const files = (await FS(AVATAR_DIR).readdir()) || [];
    const map = ensureAvatarMap();
    for (const file of files) {
      const ext = getExtension(file) as ValidExt;
      if (VALID_EXTS.includes(ext)) {
        const name = file.slice(0, -ext.length);
        map[name] = file;
      }
    }
  } catch (err) {
    console.error('Error initializing avatars:', err);
  }
})();

export const commands: Chat.ChatCommands = {
  customavatar: {
    async set(this: CommandContext, target: string, room: ChatRoom | null, user: User) {
      this.checkCan('bypassall');
      const [rawName, rawUrl] = target.split(',').map(s => s.trim());
      if (!rawName || !rawUrl) return this.parse('/help customavatar');

      const userId = toID(rawName);
      if (userId.length > 19) return this.errorReply('Username is too long.');

      const url = rawUrl.replace(/^([^:\/])/i, 'http://$1');
      const ext = getExtension(url) as ValidExt;
      if (!VALID_EXTS.includes(ext)) {
        return this.errorReply('Image must end in .jpg, .png, or .gif.');
      }

      const map = ensureAvatarMap();
      map[userId] = `${userId}${ext}`;

      await saveAvatarFile(url, userId, ext);

      this.sendReply(
        `|raw|${rawName}'s avatar was set successfully:<br>` +
        `<img src="${url}" width="80" height="80">`
      );

      popupUser(
        userId,
        `${Impulse.nameColor(user.name, true, true)} set your custom avatar.<br>` +
        `<center><img src="${url}" width="80" height="80"></center>`
      );

      this.parse(`/personalavatar ${userId},${map[userId]}`);

      logStaff(
        `${Impulse.nameColor(user.name, true, true)} set custom avatar for ` +
        `${Impulse.nameColor(rawName, true, false)}:<br>` +
        `<img src="${url}" width="50" height="50">`
      );
    },

    async delete(this: CommandContext, target: string) {
      this.checkCan('bypassall');
      const userId = toID(target);
      const map = ensureAvatarMap();
      const filename = map[userId];
      if (!filename) {
        return this.errorReply(`${target} does not have a custom avatar.`);
      }

      delete map[userId];
      await removeAvatarFile(filename);

      this.sendReply(`${target}'s avatar has been removed.`);
      popupUser(userId, `${Impulse.nameColor(this.user.name, true, true)} removed your custom avatar.`);
      this.parse(`/removeavatar ${userId}`);

      logStaff(
        `${Impulse.nameColor(this.user.name, true, true)} deleted custom avatar for ` +
        `${Impulse.nameColor(target, true, false)}.`
      );
    },

    '': function (this: CommandContext) {
      this.parse('/customavatarhelp');
    },
  },

  customavatarhelp(this: CommandContext) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<b>Custom Avatar Commands:</b><br>` +
      `• <code>/customavatar set [user], [image url]</code> — Sets a user's avatar (Requires: ~)<br>` +
      `• <code>/customavatar delete [user]</code> — Removes a user's avatar (Requires: ~)`
    );
  },
};
