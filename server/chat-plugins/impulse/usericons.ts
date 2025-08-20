/******************************************
 * Pokemon Showdown Custom Icon Commands   *
 *******************************************/

import { FS } from '../../../lib';

const DB_PATH = 'databases/usericons.json';
const CSS_PATH = 'config/custom.css';
const CSS_START = '/* ICONS START */';
const CSS_END = '/* ICONS END */';
const BACKGROUND_COLOR = 'rgba(17, 72, 79, 0.6)';
const STAFF_ROOM_ID = 'staff';

type IconMap = Record<string, string>;
let userIcons: IconMap = loadJson(DB_PATH, {});

function loadJson<T>(path: string, defaultValue: T): T {
  try {
    const data = FS(path).readIfExistsSync();
    return data ? (JSON.parse(data) as T) : defaultValue;
  } catch (err) {
    console.error(`Failed to load ${path}:`, err);
    return defaultValue;
  }
}

async function saveJson(path: string, data: unknown): Promise<void> {
  await FS(path).writeUpdate(() => JSON.stringify(data, null, 2));
}

function buildCssBlock(icons: IconMap): string {
  const rules = Object.entries(icons).map(([name, url]) => {
    const id = toID(name);
    return (
      `[id$="-userlist-user-${id}"] { ` +
        `background: ${BACKGROUND_COLOR} url("${url}") right no-repeat !important;` +
      ` }`
    );
  });
  return [CSS_START, ...rules, CSS_END].join('\n') + '\n';
}

async function replaceCssBlock(newBlock: string): Promise<void> {
  const lines = FS(CSS_PATH).readIfExistsSync().split('\n');
  const startIdx = lines.indexOf(CSS_START);
  const endIdx = lines.indexOf(CSS_END);
  if (startIdx >= 0 && endIdx >= startIdx) {
    lines.splice(startIdx, endIdx - startIdx + 1);
  }
  await FS(CSS_PATH).writeUpdate(() => [...lines, newBlock].join('\n'));
  Impulse.reloadCSS();
}

async function updateIcons(): Promise<void> {
  try {
    await saveJson(DB_PATH, userIcons);
    const css = buildCssBlock(userIcons);
    await replaceCssBlock(css);
  } catch (err) {
    console.error('Error updating user icons:', err);
  }
}

function notifyIconChange(
  targetId: string,
  actor: User,
  action: 'set' | 'delete',
  iconUrl?: string
): void {
  // Notify the target user
  const verb = action === 'set' ? 'set your userlist icon to:' : 'removed your userlist icon';
  const media = action === 'set' ? `<img src="${iconUrl}" width="32" height="32">` : '';
  const targetUser = Users.get(targetId);
  if (targetUser?.connected) {
    targetUser.popup(
      `|html|${Impulse.nameColor(actor.name, true, true)} has ${verb} ${media}`
    );
  }

  // Log to staff room
  const staffRoom = Rooms.get(STAFF_ROOM_ID);
  if (staffRoom) {
    const msg =
      action === 'set'
        ? `${Impulse.nameColor(actor.name, true, true)} set icon for ${Impulse.nameColor(targetId, true, false)}: ${media}`
        : `${Impulse.nameColor(actor.name, true, true)} removed icon for ${Impulse.nameColor(targetId, true, false)}.`;
    staffRoom.add(`|html|<div class="infobox">${msg}</div>`).update();
  }
}

export const commands: Chat.ChatCommands = {
  // alias `/usericon`
  usericon: 'icon',
  icon: {
    async set(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      const [username, url] = target.split(',').map(s => s.trim());
      if (!username || !url) return this.parse('/help icon');

      const userId = toID(username);
      if (userId.length > 19) return this.errorReply('Usernames are not this long...');
      if (userIcons[userId]) {
        return this.errorReply('This user already has an icon. Remove it first with /icon delete.');
      }

      userIcons[userId] = url;
      await updateIcons();
      this.sendReply(`|raw|You have given ${Impulse.nameColor(username, true, false)} an icon.`);
      notifyIconChange(userId, user, 'set', url);
    },

    async delete(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      const userId = toID(target);
      if (!userIcons[userId]) {
        return this.errorReply(`${target} does not have an icon.`);
      }

      delete userIcons[userId];
      await updateIcons();
      this.sendReply(`You removed ${target}'s icon.`);
      notifyIconChange(userId, user, 'delete');
    },

    '': function (this: CommandContext) {
      this.parse('/iconhelp');
    },
  },

  iconhelp(this: CommandContext) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<b>Custom Icon Commands:</b><br>` +
      `• <code>/icon set [username], [image url]</code> - Assigns an icon (Requires: @ and higher)<br>` +
      `• <code>/icon delete [username]</code> - Removes a user's icon (Requires: @ and higher)`
    );
  },
};
