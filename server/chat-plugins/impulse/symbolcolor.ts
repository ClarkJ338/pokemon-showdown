/******************************************
 * Pokemon Showdown Custom Symbol Colors   *
 * Author: @musaddiktemkar                 *
 *******************************************/

import { FS } from '../../../lib';

const DB_PATH = 'databases/symbolcolors.json';
const CSS_PATH = 'config/custom.css';
const CSS_START = '/* SYMBOLCOLORS START */';
const CSS_END = '/* SYMBOLCOLORS END */';
const STAFF_ROOM_ID = 'staff';

let symbolcolors: SymbolColors = {};

// JSON FS helpers
function readJSON<T>(path: string, defaultValue: T): T {
  try {
    const data = FS(path).readIfExistsSync();
    return data ? JSON.parse(data) as T : defaultValue;
  } catch (err) {
    console.error(`Failed to parse ${path}:`, err);
    return defaultValue;
  }
}

async function writeJSON(path: string, content: unknown): Promise<void> {
  await FS(path).writeUpdate(() => JSON.stringify(content, null, 2));
}

// Build the CSS block dynamically
function buildCssBlock(colors: SymbolColors): string {
  const rules = Object.entries(colors).map(
    ([user, color]) => {
      const id = toID(user);
      return (
        `[id$="-userlist-user-${id}"] button > em.group { color: ${color}; }\n` +
        `[class$="chatmessage-${id}"] strong small, .groupsymbol { color: ${color}; }`
      );
    }
  );
  return `${CSS_START}\n${rules.join('\n\n')}\n${CSS_END}\n`;
}

// Replace existing block in custom.css
async function replaceCssBlock(newBlock: string): Promise<void> {
  const file = FS(CSS_PATH).readIfExistsSync().split('\n');
  const start = file.indexOf(CSS_START);
  const end = file.indexOf(CSS_END);
  if (start >= 0 && end >= start) file.splice(start, end - start + 1);
  await FS(CSS_PATH).writeUpdate(() => file.concat(newBlock).join('\n'));
  Impulse.reloadCSS();
}

async function updateSymbolColors(): Promise<void> {
  try {
    await writeJSON(DB_PATH, symbolcolors);
    const cssBlock = buildCssBlock(symbolcolors);
    await replaceCssBlock(cssBlock);
  } catch (err) {
    console.error('Error updating symbol colors:', err);
  }
}

// Unified notifier for both set and delete actions
function notifyChange(
  targetId: string,
  actor: User,
  action: 'set' | 'remove'
): void {
  const targetUser = Users.get(targetId);
  if (targetUser?.connected) {
    const verb = action === 'set' ? 'set your userlist symbol color' : 'removed your userlist symbol color';
    targetUser.popup(
      `|html|${Impulse.nameColor(actor.name, true, true)} has ${verb}.`
    );
  }
  const staffRoom = Rooms.get(STAFF_ROOM_ID);
  if (staffRoom) {
    const message =
      action === 'set'
        ? `<div class="infobox">${Impulse.nameColor(actor.name, true, true)} set symbol color for ${Impulse.nameColor(targetId, true, false)}</div>`
        : `<div class="infobox">${Impulse.nameColor(actor.name, true, true)} removed symbol color for ${Impulse.nameColor(targetId, true, false)}</div>`;
    staffRoom.add(`|html|${message}`).update();
  }
}

export const commands: Chat.ChatCommands = {
  symbolcolor: {
    async set(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      const [name, color] = target.split(',').map(s => s.trim());
      if (!name || !color) return this.parse('/help symbolcolor');

      const userId = toID(name);
      if (userId.length > 19) return this.errorReply('Usernames are not this long...');
      if (symbolcolors[userId]) {
        return this.errorReply('This user already has a symbol color. Use `/symbolcolor delete` first.');
      }

      symbolcolors[userId] = color;
      await updateSymbolColors();

      this.sendReply(`|raw|You have given ${Impulse.nameColor(name, true, false)} a symbol color.`);
      notifyChange(userId, user, 'set');
    },

    async delete(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      const userId = toID(target);
      if (!symbolcolors[userId]) {
        return this.errorReply(`${target} does not have a symbol color.`);
      }

      delete symbolcolors[userId];
      await updateSymbolColors();

      this.sendReply(`You removed ${target}'s symbol color.`);
      notifyChange(userId, user, 'remove');
    },

    '': function (this: CommandContext, target, room, user) {
      this.parse('/symbolcolorhelp');
    },
  },

  symbolcolorhelp(this: CommandContext) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<b>Custom Symbol Color Commands:</b><br>` +
      `• <code>/symbolcolor set [username], [hex]</code> - Assigns a symbol color (Requires: @ and higher)<br>` +
      `• <code>/symbolcolor delete [username]</code> - Revokes a symbol color (Requires: @ and higher)`
    );
  },
};
