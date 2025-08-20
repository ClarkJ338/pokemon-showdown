/******************************************
 * Custom Colors Commands
 * Credits: panpawn, jd, HoeenHero
 * Updates & Typescript Conversion: Prince Sky
 ******************************************/

import * as crypto from 'crypto';
import { FS } from '../../../lib';

const DATA_PATH = 'databases/customcolors.json';
const CSS_PATH = 'config/custom.css';
const CSS_START = '/* COLORS START */';
const CSS_END = '/* COLORS END */';
const STAFF_ROOM_ID = 'staff';

interface RGB { R: number; G: number; B: number; }
type ColorMap = Record<string, string>;

// In-memory store
let customColors: ColorMap = loadJson(DATA_PATH, {});

// In-process cache for auto-generated colors
const autoColorCache: Record<string, string> = {};

function loadJson<T>(path: string, def: T): T {
  try {
    const raw = FS(path).readIfExistsSync();
    return raw ? JSON.parse(raw) as T : def;
  } catch (err) {
    console.error(`Failed to load ${path}:`, err);
    return def;
  }
}

async function saveJson(path: string, data: unknown): Promise<void> {
  await FS(path).writeUpdate(() => JSON.stringify(data, null, 2));
}

function md5Hash(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex');
}

function hslToRgb(H: number, S: number, L: number): RGB {
  const C = ((100 - Math.abs(2 * L - 100)) * S) / 10000;
  const X = C * (1 - Math.abs((H / 60) % 2 - 1));
  const m = L / 100 - C / 2;
  let [R1, G1, B1] = [0, 0, 0];

  switch (Math.floor(H / 60)) {
    case 0: [R1, G1] = [C, X]; break;
    case 1: [R1, G1] = [X, C]; break;
    case 2: [G1, B1] = [C, X]; break;
    case 3: [G1, B1] = [X, C]; break;
    case 4: [R1, B1] = [X, C]; break;
    case 5: [R1, B1] = [C, X]; break;
  }
  return { R: R1 + m, G: G1 + m, B: B1 + m };
}

function rgbToHex({ R, G, B }: RGB): string {
  const comp = (v: number) => {
    const h = Math.round(v * 255).toString(16);
    return h.length === 1 ? '0' + h : h;
  };
  return `#${comp(R)}${comp(G)}${comp(B)}`;
}

function generateAutoColor(name: string): string {
  const id = toID(name);
  if (autoColorCache[id]) return autoColorCache[id];

  const hash = md5Hash(id);
  const H = parseInt(hash.slice(4, 8), 16) % 360;
  const S = (parseInt(hash.slice(0, 4), 16) % 50) + 40;
  let L = (parseInt(hash.slice(8, 12), 16) % 20) + 30;

  // Luminance tweak
  const { R, G, B } = hslToRgb(H, S, L);
  const lum = R ** 3 * 0.2126 + G ** 3 * 0.7152 + B ** 3 * 0.0722;
  let mod = (lum - 0.2) * -150;
  mod = mod > 18 ? (mod - 18) * 2.5 : mod < 0 ? mod / 3 : mod;
  const Hdist = Math.min(Math.abs(180 - H), Math.abs(240 - H));
  if (Hdist < 15) mod += (15 - Hdist) / 3;
  L += mod;

  const finalRgb = hslToRgb(H, S, L);
  const hex = rgbToHex(finalRgb);
  autoColorCache[id] = hex;
  return hex;
}

export function nameColor(name: string): string {
  const id = toID(name);
  return customColors[id] || generateAutoColor(name);
}

Impulse.hashColor = nameColor;

function generateCssBlock(colors: ColorMap): string {
  const rules = Object.entries(colors).map(([name, col]) => {
    const id = toID(name);
    return [
      `[class$="chatmessage-${id}"] strong,`,
      `[class$="chatmessage-${id} mine"] strong,`,
      `[class$="chatmessage-${id} highlighted"] strong,`,
      `[id$="-userlist-user-${id}"] strong em,`,
      `[id$="-userlist-user-${id}"] strong,`,
      `[id$="-userlist-user-${id}"] span`,
      `{ color: ${col} !important; }`,
    ].join(' ');
  });
  return [CSS_START, ...rules, CSS_END].join('\n') + '\n';
}

async function replaceCss(newBlock: string): Promise<void> {
  const lines = FS(CSS_PATH).readIfExistsSync().split('\n');
  const start = lines.indexOf(CSS_START);
  const end = lines.indexOf(CSS_END);
  if (start >= 0 && end >= start) {
    lines.splice(start, end - start + 1);
  }
  await FS(CSS_PATH).writeUpdate(() => [...lines, newBlock].join('\n'));
  Impulse.reloadCSS();
}

async function updateColorCss(): Promise<void> {
  await saveJson(DATA_PATH, customColors);
  const block = generateCssBlock(customColors);
  await replaceCss(block);
}

function notifyChange(
  targetId: string,
  actor: User,
  action: 'set' | 'delete',
  color?: string
) {
  const verb = action === 'set'
    ? `set your custom color to <font color="${color}">${color}</font>`
    : 'removed your custom color';
  const tgtUser = Users.get(targetId);
  if (tgtUser?.connected) {
    tgtUser.popup(`|html|${Impulse.nameColor(actor.name, true, true)} has ${verb}.`);
  }

  const staffRoom = Rooms.get(STAFF_ROOM_ID);
  if (staffRoom) {
    const msg = action === 'set'
      ? `${Impulse.nameColor(actor.name, true, true)} set custom color for ${Impulse.nameColor(targetId, true, false)} to ${color}.`
      : `${Impulse.nameColor(actor.name, true, true)} removed custom color for ${Impulse.nameColor(targetId, true, false)}.`;
    staffRoom.add(`|html|<div class="infobox">${msg}</div>`).update();
  }
}

export const commands: Chat.ChatCommands = {
  customcolor: {
    set(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      const [rawName, rawColor] = target.split(',').map(s => s.trim());
      if (!rawName || !rawColor) return this.parse('/help customcolor');

      const id = toID(rawName);
      if (id.length > 19) return this.errorReply("Usernames are not this long...");
      if (customColors[id]) {
        return this.errorReply(`${rawName} already has a custom color. Use /customcolor delete first.`);
      }

      customColors[id] = rawColor;
      void updateColorCss();

      this.sendReply(`|raw|You have given <b><font color="${rawColor}">${Chat.escapeHTML(rawName)}</font></b> a custom color.`);
      this.modlog('CUSTOMCOLOR', rawName, `set color ${rawColor}`);
      notifyChange(id, user, 'set', rawColor);
    },

    delete(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      if (!target) return this.parse('/help customcolor');

      const id = toID(target);
      if (!customColors[id]) {
        return this.errorReply(`${target} does not have a custom color.`);
      }

      delete customColors[id];
      void updateColorCss();

      this.sendReply(`You removed ${target}'s custom color.`);
      this.modlog('CUSTOMCOLOR', target, 'removed color');
      notifyChange(id, user, 'delete');
    },

    preview(this: CommandContext, target, room, user) {
      if (!this.runBroadcast()) return;
      const [rawName, rawColor] = target.split(',').map(s => s.trim());
      if (!rawName || !rawColor) return this.parse('/help customcolor');

      return this.sendReplyBox(
        `<b><font size="3" color="${rawColor}">${Chat.escapeHTML(rawName)}</font></b>`
      );
    },

    reload(this: CommandContext, target, room, user) {
      this.checkCan('bypassall');
      void updateColorCss();
      this.privateModAction(`(${user.name} reloaded custom colours.)`);
    },

    ''(this: CommandContext) {
      this.parse('/help customcolor');
    },
  },

  customcolorhelp(this: CommandContext) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<div><b><center>Custom Color Commands</center></b>` +
      `<ul>` +
      `<li><code>/customcolor set [user], [hex]</code> — assign a custom color (Requires: @+)</li>` +
      `<li><code>/customcolor delete [user]</code> — remove a custom color (Requires: @+)</li>` +
      `<li><code>/customcolor reload</code> — reload colors (Requires: ~)</li>` +
      `<li><code>/customcolor preview [user], [hex]</code> — preview a color</li>` +
      `</ul></div>`
    );
  },

  '!hex': true,
  hex(this: CommandContext, target, room, user) {
    if (!this.runBroadcast()) return;
    const name = target.trim() || user.name;
    const color = nameColor(name);
    this.sendReplyBox(
      `The hex code for ${Impulse.nameColor(name, true, true)} is ` +
      `<font color="${color}"><b>${color}</b></font>`
    );
  },
};
