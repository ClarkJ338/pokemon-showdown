/***************************************
* Pokemon Showdown EXP Commands        *
* Original Code By: Volco & Insist     *
* Updated To Typescript By: Prince Sky *
* Improved Version with 30% Level Bonus*
***************************************/

/*********************************************
* Add this code in server/chat.ts            *
* In parse function//Output the message      *
* if (this.user.registered)                  *
* Impulse.ExpSystem.addExp(this.user.id, 1); *
*********************************************/

import { FS } from '../../. /lib';

// Constants
const EXP_FILE_PATH = 'databases/exp.json';
const EXP_CONFIG_PATH = 'databases/exp-config.json';
const DEFAULT_EXP = 0;
const EXP_UNIT = 'EXP';
const MIN_LEVEL_EXP = 2;
const MULTIPLIER = 1.4;
const EXP_COOLDOWN = 30000; // 30 seconds
const LEVEL_UP_BONUS_PERCENTAGE = 0.3; // 30% bonus
const MILESTONE_INTERVAL = 5; // Milestone every 5 levels
const ANNOUNCEMENT_INTERVAL = 10; // Announce every 10 levels

Impulse.expUnit = EXP_UNIT;

// Types
interface ExpData {
  [userid: string]: number;
}

interface CooldownData {
  [userid: string]: number;
}

interface ExpConfig {
  doubleExp: boolean;
  doubleExpEndTime: number | null;
}

// Utility functions
const formatTime = (date: Date): string => {
  return date.toISOString().replace('T', ' ').slice(0, 19);
};

const getDurationMs = (value: number, unit: string): number => {
  const units: Record<string, number> = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000
  };
  return value * (units[unit] || 0);
};

export class ExpSystem {
  private static data: ExpData = ExpSystem.loadExpData();
  private static cooldowns: CooldownData = {};
  private static config: ExpConfig = ExpSystem.loadExpConfig();
  private static doubleExp = false;
  private static doubleExpEndTime: number | null = null;

  // File I/O methods
  private static loadExpData(): ExpData {
    try {
      const rawData = FS(EXP_FILE_PATH).readIfExistsSync();
      return rawData ? JSON.parse(rawData) as ExpData : {};
    } catch (error) {
      console.error(`Error reading EXP data: ${error}`);
      return {};
    }
  }

  private static saveExpData(): void {
    try {
      const dataToWrite = Object.fromEntries(
        Object.entries(this.data).map(([id, amount]) => [toID(id), amount])
      );
      FS(EXP_FILE_PATH).writeUpdate(() => JSON.stringify(dataToWrite, null, 2));
    } catch (error) {
      console.error(`Error saving EXP data: ${error}`);
    }
  }

  private static loadExpConfig(): ExpConfig {
    try {
      const rawData = FS(EXP_CONFIG_PATH).readIfExistsSync();
      if (rawData) {
        const config = JSON.parse(rawData) as ExpConfig;
        this.doubleExp = config.doubleExp;
        this.doubleExpEndTime = config.doubleExpEndTime;
        return config;
      }
      return { doubleExp: false, doubleExpEndTime: null };
    } catch (error) {
      console.error(`Error reading EXP config: ${error}`);
      return { doubleExp: false, doubleExpEndTime: null };
    }
  }

  private static saveExpConfig(): void {
    try {
      const config: ExpConfig = {
        doubleExp: this.doubleExp,
        doubleExpEndTime: this.doubleExpEndTime
      };
      FS(EXP_CONFIG_PATH).writeUpdate(() => JSON.stringify(config, null, 2));
    } catch (error) {
      console.error(`Error saving EXP config: ${error}`);
    }
  }

  // Helper methods
  private static isOnCooldown(userid: string): boolean {
    const lastExp = this.cooldowns[userid] || 0;
    return Date.now() - lastExp < EXP_COOLDOWN;
  }

  private static applyDoubleExp(amount: number): number {
    return this.doubleExp ? amount * 2 : amount;
  }

  private static calculateLevelUpBonus(level: number): number {
    const expForNextLevel = this.getExpForNextLevel(level + 1) - this.getExpForNextLevel(level);
    return Math.floor(expForNextLevel * LEVEL_UP_BONUS_PERCENTAGE);
  }

  private static isMilestoneLevel(level: number): boolean {
    return level % MILESTONE_INTERVAL === 0;
  }

  private static isAnnouncementLevel(level: number): boolean {
    return level % ANNOUNCEMENT_INTERVAL === 0;
  }

  // Core EXP methods
  static writeExp(userid: string, amount: number): void {
    this.data[toID(userid)] = amount;
    this.saveExpData();
  }

  static readExp(userid: string): number {
    return this.data[toID(userid)] || DEFAULT_EXP;
  }

  static hasExp(userid: string, amount: number): boolean {
    return this.readExp(userid) >= amount;
  }

  static addExp(userid: string, amount: number, reason?: string, by?: string): number {
    const id = toID(userid);
    
    // Check cooldown for natural exp gain (not admin-given)
    if (!by && this.isOnCooldown(id)) {
      return this.readExp(id);
    }

    const currentExp = this.readExp(id);
    const currentLevel = this.getLevel(currentExp);
    
    const gainedAmount = this.applyDoubleExp(amount);
    this.data[id] = (this.data[id] || 0) + gainedAmount;
    
    // Set cooldown for natural exp gain
    if (!by) {
      this.cooldowns[id] = Date.now();
    }
    
    this.saveExpData();
    
    // Check for level up
    const newLevel = this.getLevel(this.data[id]);
    if (newLevel > currentLevel) {
      this.handleLevelUp(id, newLevel, currentLevel);
    }
    
    return this.data[id];
  }

  static addExpRewards(userid: string, amount: number, reason?: string, by?: string): number {
    const id = toID(userid);
    const currentExp = this.readExp(id);
    const currentLevel = this.getLevel(currentExp);
    
    const gainedAmount = this.applyDoubleExp(amount);
    this.data[id] = (this.data[id] || 0) + gainedAmount;
    
    this.saveExpData();
    
    // Check for level up
    const newLevel = this.getLevel(this.data[id]);
    if (newLevel > currentLevel) {
      this.handleLevelUp(id, newLevel, currentLevel);
    }
    
    return this.data[id];
  }

  // Level up handling with 30% bonus
  private static handleLevelUp(userid: string, newLevel: number, oldLevel: number): void {
    // Calculate and award 30% bonus
    const levelUpBonus = this.calculateLevelUpBonus(newLevel);
    this.data[toID(userid)] += levelUpBonus;
    this.saveExpData();
    
    this.notifyLevelUp(userid, newLevel, oldLevel, levelUpBonus);
  }

  static notifyLevelUp(userid: string, newLevel: number, oldLevel: number, levelUpBonus: number = 0): void {
    const user = Users.get(userid);
    if (!user?.connected) return;
    
    let rewards = '';
    
    // Milestone bonus (original milestone system)
    if (this.isMilestoneLevel(newLevel)) {
      const milestoneBonus = newLevel * 5;
      this.addExpRewards(userid, milestoneBonus, 'Level milestone bonus');
      rewards += `Milestone bonus: ${milestoneBonus} ${EXP_UNIT}! `;
    }
    
    // Level up bonus message
    if (levelUpBonus > 0) {
      rewards += `Level up bonus: ${levelUpBonus} ${EXP_UNIT}! `;
    }
    
    // Send level up notification
    const popupHTML = this.createLevelUpPopupHTML(newLevel, oldLevel, rewards);
    user.popup(popupHTML);
    
    // Public announcement for significant levels
    if (this.isAnnouncementLevel(newLevel)) {
      this.announceLevel(userid, newLevel);
    }
  }

  private static createLevelUpPopupHTML(newLevel: number, oldLevel: number, rewards: string): string {
    return (
      `|html|<div style="text-align: center;">` +
      `<h3 style="color: #3498db;">Level Up!</h3>` +
      `<div style="font-size: 1.2em; margin: 10px 0;">` +
      `You are now <b style="color: #e74c3c;">Level ${newLevel}</b>!` +
      `</div>` +
      `<div style="margin: 10px 0; font-style: italic;">` +
      `You advanced from Level ${oldLevel} to Level ${newLevel}` +
      `</div>` +
      (rewards ? `<div style="margin-top: 10px; color: #27ae60;">${rewards}</div>` : '') +
      `<div style="margin-top: 15px; font-size: 0.9em; opacity: 0.8;">` +
      `Keep chatting and participating to earn more ${EXP_UNIT}!` +
      `</div>` +
      `</div>`
    );
  }

  private static announceLevel(userid: string, level: number): void {
    const mainRoom = Rooms.get('lobby');
    if (mainRoom) {
      mainRoom.add(
        `|html|<div class="broadcast-blue">` +
        `<b>${Impulse.nameColor(userid, true, true)}</b> has reached <b>Level ${level}</b>!` +
        `</div>`
      ).update();
    }
  }

  // Double EXP management
  static checkDoubleExpStatus(room?: Room | null, user?: User): void {
    if (this.doubleExp && this.doubleExpEndTime && Date.now() >= this.doubleExpEndTime) {
      this.doubleExp = false;
      this.doubleExpEndTime = null;
      this.saveExpConfig();
    }
    
    if (room) {
      this.broadcastDoubleExpStatus(room, user);
    }
  }

  private static broadcastDoubleExpStatus(room: Room, user?: User): void {
    const durationText = this.doubleExpEndTime 
      ? `until ${formatTime(new Date(this.doubleExpEndTime))} UTC`
      : 'No duration specified';
    
    const userText = user ? ` by ${Impulse.nameColor(user.name, true, true)}` : '';
    const statusText = this.doubleExp ? 'enabled' : (this.doubleExpEndTime ? 'ended' : 'disabled');
    
    const message = 
      `<div class="broadcast-blue">` +
      `<b>Double EXP has been ${statusText}${userText}!</b><br>` +
      (this.doubleExp ? `Duration: ${durationText}<br>` : '') +
      `All EXP gains will now be ${this.doubleExp ? 'doubled' : 'normal'}.` +
      `</div>`;

    room.add(`|html|${message}`).update();
  }

  static toggleDoubleExp(enable?: boolean, duration?: number): void {
    if (enable !== undefined) {
      this.doubleExp = enable;
      this.doubleExpEndTime = duration ? Date.now() + duration : null;
    } else {
      this.doubleExp = !this.doubleExp;
      this.doubleExpEndTime = null;
    }
    
    this.saveExpConfig();
    
    if (this.doubleExp && this.doubleExpEndTime) {
      setTimeout(() => this.checkDoubleExpStatus(), this.doubleExpEndTime - Date.now());
    }
  }

  // Utility methods
  static grantExp(): void {
    Users.users.forEach(user => {
      if (!user?.named || !user.connected || !user.lastPublicMessage) return;
      if (Date.now() - user.lastPublicMessage > 300000) return; // 5 minutes
      this.addExp(user.id, 1);
    });
  }

  static takeExp(userid: string, amount: number, reason?: string, by?: string): number {
    const id = toID(userid);
    const currentExp = this.data[id] || 0;
    
    if (currentExp >= amount) {
      this.data[id] = currentExp - amount;
      this.saveExpData();
      return this.data[id];
    }
    
    return currentExp;
  }

  static resetAllExp(): void {
    this.data = {};
    this.saveExpData();
  }

  static getRichestUsers(limit: number = 100): [string, number][] {
    return Object.entries(this.data)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit);
  }

  // Level calculation methods
  static getLevel(exp: number): number {
    if (exp < MIN_LEVEL_EXP) return 0;
    
    let level = 1;
    let totalExp = MIN_LEVEL_EXP;
    
    while (exp >= totalExp) {
      totalExp += Math.floor(MIN_LEVEL_EXP * Math.pow(MULTIPLIER, level));
      level++;
    }
    
    return level - 1;
  }

  static getExpForNextLevel(level: number): number {
    if (level <= 0) return MIN_LEVEL_EXP;
    
    let totalExp = MIN_LEVEL_EXP;
    for (let i = 1; i < level; i++) {
      totalExp += Math.floor(MIN_LEVEL_EXP * Math.pow(MULTIPLIER, i));
    }
    
    return totalExp;
  }

  // Getter methods for external access
  static get isDoubleExpActive(): boolean {
    return this.doubleExp;
  }

  static get doubleExpEndTime(): number | null {
    return this.doubleExpEndTime;
  }
}

// Initialize the system
Impulse.ExpSystem = ExpSystem;

export const pages: Chat.PageTable = {
  expladder(args, user) {
    const richest = ExpSystem.getRichestUsers(100);
    if (!richest.length) {
      return `<div class="pad"><h2>No users have any ${EXP_UNIT} yet.</h2></div>`;
    }

    const data = richest.map(([userid, exp], index) => {
      const level = ExpSystem.getLevel(exp);
      const expForNext = ExpSystem.getExpForNextLevel(level + 1);
      return [
        (index + 1).toString(),
        Impulse.nameColor(userid, true, true),
        `${exp} ${EXP_UNIT}`,
        level.toString(),
        `${expForNext} ${EXP_UNIT}`,
      ];
    });

    const output = Impulse.generateThemedTable(
      `Top ${richest.length} Users by ${EXP_UNIT}`,
      ['Rank', 'User', 'EXP', 'Level', 'Next Level At'],
      data,
      Impulse.nameColor('TurboRx', true, true)
    );
    
    return `<div class="pad ladder">${output}</div>`;
  },
};

export const commands: Chat.Commands = {
  level: 'exp',
  exp(target, room, user) {
    if (!target) target = user.name;
    if (!this.runBroadcast()) return;
    
    const userid = toID(target);
    const currentExp = ExpSystem.readExp(userid);
    const currentLevel = ExpSystem.getLevel(currentExp);
    const nextLevelExp = ExpSystem.getExpForNextLevel(currentLevel + 1);
    const previousLevelExp = ExpSystem.getExpForNextLevel(currentLevel);
    
    const expInCurrentLevel = currentExp - previousLevelExp;
    const expNeededForNextLevel = nextLevelExp - previousLevelExp;
    const progressPercentage = Math.floor((expInCurrentLevel / expNeededForNextLevel) * 100);
    const expNeeded = nextLevelExp - currentExp;
    
    const progressBarHTML = this.createProgressBarHTML(progressPercentage);
    const expDisplayHTML = this.createExpDisplayHTML(
      userid, currentLevel, currentExp, expNeeded, nextLevelExp, progressBarHTML, progressPercentage
    );
    
    this.sendReplyBox(expDisplayHTML);
  },

  createProgressBarHTML(percentage: number): string {
    return (
      `<div style="width: 200px; height: 18px; background: rgba(200, 200, 200, 0.2); border-radius: 10px; overflow: hidden; border: 1px solid rgba(150, 150, 150, 0.3); margin: 5px auto;">` +
      `<div style="width: ${percentage}%; height: 100%; background: linear-gradient(90deg, #3498db, #2980b9); box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.2);"></div>` +
      `</div>`
    );
  },

  createExpDisplayHTML(userid: string, level: number, currentExp: number, expNeeded: number, nextLevelExp: number, progressBar: string, percentage: number): string {
    return (
      `<div style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.05)); border-radius: 10px; padding: 12px; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1); border: 1px solid rgba(125, 125, 125, 0.2);">` +
      
      `<div style="text-align: center; margin-bottom: 8px;">` +
      `<div style="font-size: 1.5em; font-weight: bold;">` +
      `<span>${Impulse.nameColor(userid, true, false)}</span>` +
      `</div>` +
      `</div>` +
      
      `<div style="text-align: center; margin-bottom: 10px;">` +
      `<div style="font-size: 1.3em; font-weight: bold; display: inline-block; padding: 3px 12px; border-radius: 15px; background: linear-gradient(90deg, rgba(52, 152, 219, 0.2), rgba(155, 89, 182, 0.2)); color: #3498db;">` +
      `Level ${level}` +
      `</div>` +
      `</div>` +
      
      `<div style="margin: 12px 0;">${progressBar}</div>` +
      
      `<div style="text-align: center; font-size: 0.9em; margin-bottom: 10px;">` +
      `${percentage}% complete` +
      `</div>` +
      
      `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 5px;">` +
      `<div style="background: rgba(150, 150, 150, 0.1); padding: 8px; border-radius: 8px; text-align: center;">` +
      `<div style="font-size: 0.8em; opacity: 0.7;">Current EXP</div>` +
      `<div style="font-weight: bold; color: #3498db;">${currentExp} ${EXP_UNIT}</div>` +
      `</div>` +
      `<div style="background: rgba(150, 150, 150, 0.1); padding: 8px; border-radius: 8px; text-align: center;">` +
      `<div style="font-size: 0.8em; opacity: 0.7;">Needed for Level ${level + 1}</div>` +
      `<div style="font-weight: bold; color: #e74c3c;">${expNeeded} ${EXP_UNIT}</div>` +
      `</div>` +
      `</div>` +
      
      `<div style="font-size: 0.8em; margin-top: 10px; text-align: center; opacity: 0.7;">` +
      `Total progress: ${currentExp}/${nextLevelExp} ${EXP_UNIT}` +
      `</div>` +
      `</div>`
    );
  },

  giveexp(target, room, user) {
    this.checkCan('bypassall');
    if (!target) return this.sendReply(`Usage: /giveexp [user], [amount], [reason]`);
    
    const parts = target.split(',').map(p => p.trim());
    if (parts.length < 2) return this.sendReply(`Usage: /giveexp [user], [amount], [reason]`);

    const targetUser = Users.get(parts[0]);
    const amount = parseInt(parts[1], 10);
    const reason = parts.slice(2).join(',').trim() || 'No reason specified.';

    if (!targetUser) return this.errorReply(`User "${parts[0]}" not found.`);
    if (isNaN(amount) || amount <= 0) return this.errorReply(`Please specify a valid positive amount.`);

    ExpSystem.addExp(targetUser.id, amount, reason, user.id);
    
    this.sendExpUpdateReply(user, targetUser, amount, 'gave', reason);
    this.logExpAction('GIVEEXP', targetUser, amount, user.id, reason);
    this.notifyUser(targetUser, user, amount, 'received', reason);
  },

  takeexp(target, room, user) {
    this.checkCan('bypassall');
    if (!target) return this.sendReply(`Usage: /takeexp [user], [amount], [reason]`);
    
    const parts = target.split(',').map(p => p.trim());
    if (parts.length < 2) return this.sendReply(`Usage: /takeexp [user], [amount], [reason]`);

    const targetUser = Users.get(parts[0]);
    const amount = parseInt(parts[1], 10);
    const reason = parts.slice(2).join(',').trim() || 'No reason specified.';

    if (!targetUser) return this.errorReply(`User "${parts[0]}" not found.`);
    if (isNaN(amount) || amount <= 0) return this.errorReply(`Please specify a valid positive amount.`);

    ExpSystem.takeExp(targetUser.id, amount, reason, user.id);
    
    this.sendExpUpdateReply(user, targetUser, amount, 'took', reason);
    this.logExpAction('TAKEEXP', targetUser, amount, user.id, reason);
    this.notifyUser(targetUser, user, amount, 'taken', reason);
  },

  sendExpUpdateReply(actor: User, target: User, amount: number, action: string, reason: string) {
    const newExp = ExpSystem.readExp(target.id);
    const newLevel = ExpSystem.getLevel(newExp);
    const expForNext = ExpSystem.getExpForNextLevel(newLevel + 1);
    const doubleExpText = ExpSystem.isDoubleExpActive ? ' (Double EXP)' : '';
    
    this.sendReplyBox(
      `${Impulse.nameColor(actor.name, true, true)} ${action} ${amount} ${EXP_UNIT}${doubleExpText} ${action === 'gave' ? 'to' : 'from'} ${Impulse.nameColor(target.name, true, true)} (${reason}). ` +
      `New Level: ${newLevel} (${newExp}/${expForNext} ${EXP_UNIT})`
    );
  },

  logExpAction(action: string, target: User, amount: number, byUserId: string, reason: string) {
    const doubleExpText = ExpSystem.isDoubleExpActive ? ' (Double EXP)' : '';
    this.modlog(action, target, `${amount} ${EXP_UNIT}${doubleExpText}`, { by: byUserId, reason });
  },

  notifyUser(target: User, actor: User, amount: number, action: string, reason: string) {
    if (!target.connected) return;
    
    const newExp = ExpSystem.readExp(target.id);
    const newLevel = ExpSystem.getLevel(newExp);
    const expForNext = ExpSystem.getExpForNextLevel(newLevel + 1);
    const doubleExpText = ExpSystem.isDoubleExpActive ? ' (Double EXP)' : '';
    const actionText = action === 'received' ? 'from' : 'by';
    
    target.popup(
      `|html|You ${action} <b>${amount} ${EXP_UNIT}${doubleExpText}</b> ${actionText} <b>${Impulse.nameColor(actor.name, true, true)}</b>.<br>` +
      `Reason: ${reason}<br>` +
      `You are now Level ${newLevel} (${newExp}/${expForNext} ${EXP_UNIT})`
    );
  },

  resetexp(target, room, user) {
    this.checkCan('bypassall');
    if (!target) return this.sendReply(`Usage: /resetexp [user], [reason]`);
    
    const parts = target.split(',').map(p => p.trim());
    const targetUser = Users.get(parts[0]);
    const reason = parts.slice(1).join(',').trim() || 'No reason specified.';

    if (!targetUser) return this.errorReply(`User "${parts[0]}" not found.`);

    ExpSystem.writeExp(targetUser.id, DEFAULT_EXP);
    
    this.sendReplyBox(
      `${Impulse.nameColor(user.name, true, true)} reset ${Impulse.nameColor(targetUser.name, true, true)}'s EXP to ${DEFAULT_EXP} ${EXP_UNIT} (Level 0) (${reason}).`
    );
    
    this.modlog('RESETEXP', targetUser, `${DEFAULT_EXP} ${EXP_UNIT}`, { by: user.id, reason });
    
    if (targetUser.connected) {
      targetUser.popup(
        `|html|Your ${EXP_UNIT} has been reset to <b>${DEFAULT_EXP}</b> (Level 0) by <b>${Impulse.nameColor(user.name, true, true)}</b>.<br>` +
        `Reason: ${reason}`
      );
    }
  },

  resetexpall(target, room, user) {
    this.checkCan('bypassall');
    const reason = target.trim() || 'No reason specified.';

    ExpSystem.resetAllExp();
    
    this.sendReplyBox(`All user EXP has been reset to ${DEFAULT_EXP} ${EXP_UNIT} (Level 0) (${reason}).`);
    this.modlog('RESETEXPALL', null, `all EXP to ${DEFAULT_EXP} ${EXP_UNIT}`, { by: user.id, reason });
    
    if (room) {
      room.add(
        `|html|<center><div class="broadcast-blue">` +
        `<b>${Impulse.nameColor(user.name, true, true)}</b> has reset all ${EXP_UNIT} to <b>${DEFAULT_EXP}</b> (Level 0).<br>` +
        `Reason: ${reason}` +
        `</div></center>`
      );
      room.update();
    }
  },

  toggledoubleexp(target, room, user) {
    this.checkCan('bypassall');
    
    if (!target) {
      ExpSystem.toggleDoubleExp();
      ExpSystem.checkDoubleExpStatus(room, user);
      return;
    }

    if (target.toLowerCase() === 'off') {
      ExpSystem.toggleDoubleExp(false);
      ExpSystem.checkDoubleExpStatus(room, user);
      return;
    }

    const match = target.match(/^(\d+)\s*(minute|hour|day)s?$/i);
    if (!match) {
      return this.errorReply('Invalid format. Use: number + unit (minutes/hours/days)');
    }

    const [, amount, unit] = match;
    const duration = getDurationMs(parseInt(amount), unit.toLowerCase());
    
    ExpSystem.toggleDoubleExp(true, duration);
    ExpSystem.checkDoubleExpStatus(room, user);
  },
  
  expladder(target, room, user) {
    if (!this.runBroadcast()) return;
    return this.parse(`/join view-expladder`);
  },

  exphelp(target, room, user) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<div><b><center>EXP System Commands By ${Impulse.nameColor('Prince Sky', true, true)}</center></b>` +
      `<ul>` +
      `<li><code>/level [user]</code> (Or <code>/exp</code>) - Check your or another user's EXP, current level, and EXP needed for the next level.</li>` +
      `<li><code>/giveexp [user], [amount], [reason]</code> - Give a specified amount of EXP to a user. (Requires: @ and higher)</li>` +
      `<li><code>/takeexp [user], [amount], [reason]</code> - Take a specified amount of EXP from a user. (Requires: @ and higher)</li>` +
      `<li><code>/resetexp [user], [reason]</code> - Reset a user's EXP to ${DEFAULT_EXP}. (Requires: @ and higher)</li>` +
      `<li><code>/resetexpall [reason]</code> - Reset all users' EXP to ${DEFAULT_EXP}. (Requires: @ and higher)</li>` +
      `<li><code>/expladder</code> - View the top 100 users with the most EXP and their levels.</li>` +
      `<li><code>/toggledoubleexp [duration]</code> - Toggle double EXP with optional duration (e.g., "2 hours", "1 day", "30 minutes"). Use "off" to disable. (Requires: @ and higher)</li>` +
      `</ul>` +
      `<div style="margin-top: 10px; padding: 8px; background: rgba(52, 152, 219, 0.1); border-radius: 5px;">` +
      `<b>New Feature:</b> Users now receive a 30% EXP bonus towards their next level when they level up!` +
      `</div>` +
      `</div>`
    );
  },
};