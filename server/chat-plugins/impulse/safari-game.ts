/* server/chat-plugins/safari-game.ts
 *
 * Safari Game Class - Core game logic with uhtml UI updates
 */

import {Dex} from '../../../sim/dex';
import type {Room, User} from '../../../server/types';

const DEFAULT_BALLS = 30;
const DEFAULT_TIMEOUT = 30 * 1000; // 30s per turn
const DEFAULT_TIMEBANK = 120 * 1000; // 120s total per player
const DEFAULT_BLITZ_DURATION = 120 * 1000; // 120s blitz

interface Participant {
  user: User;
  balls: number;
  score: number;
  timeBank: number;
}

type Mode = 'normal' | 'team' | 'blitz';

export {DEFAULT_BALLS, DEFAULT_TIMEOUT, DEFAULT_TIMEBANK, DEFAULT_BLITZ_DURATION, Participant, Mode};

export class SafariGame {
  room: Room;
  host: User;
  ballsPerPlayer: number;
  turnTimeout: number;
  timeBankDefault: number;
  blitzDuration: number;
  mode: Mode;
  participants = new Map<string, Participant>();
  spectators = new Set<string>();
  turnOrder: string[] = [];
  turnIndex = 0;
  timer: NodeJS.Timeout | null = null;
  warningTimer: NodeJS.Timeout | null = null;
  turnStartTime = 0;
  started = false;
  teamAssignments: Map<string, string> = new Map(); // user.id -> team name

  constructor(
    room: Room, host: User,
    balls: number, timeout: number,
    timeBank: number, blitzDur: number, mode: Mode
  ) {
    this.room = room;
    this.host = host;
    this.ballsPerPlayer = balls;
    this.turnTimeout = timeout;
    this.timeBankDefault = timeBank;
    this.blitzDuration = blitzDur;
    this.mode = mode;
  }

  // Generate lobby UI HTML
  private getLobbyHTML(): string {
    const playersList = [...this.participants.values()]
      .map(p => `<li>${p.user.name}</li>`)
      .join('');
    
    const spectatorsList = [...this.spectators]
      .map(uid => {
        const user = this.room.server.getUser(uid);
        return user ? `<li>${user.name}</li>` : '';
      })
      .filter(Boolean)
      .join('');

    let html = `<div style="border: 2px solid #4CAF50; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);">` +
        `<h3 style="margin: 0 0 10px 0; color: #2563eb;">ðŸŒ¿ Safari Zone Lobby</h3>` +
       ` <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px;">` +
         ` <div>` +
            `<strong>Game Settings:</strong>` +
           ` <ul style="margin: 5px 0; padding-left: 20px;">` +
           `   <li>Host: <strong>${this.host.name}</strong></li>` +
           `   <li>Mode: <strong>${this.mode}</strong></li>` +
           `   <li>Balls: <strong>${this.ballsPerPlayer}</strong></li>`;
    
    if (this.mode !== 'blitz') {
      html += `<li>Turn timeout: <strong>${this.turnTimeout / 1000}s</strong></li>` +
                `<li>Time bank: <strong>${this.timeBankDefault / 1000}s</strong></li>`;
    } else {
      html += `<li>Blitz duration: <strong>${this.blitzDuration / 1000}s</strong></li>`;
    }
    
    html += `</ul></div>`
          `<div><strong>Players (${this.participants.size}):</strong>` +
         `   <ul style="margin: 5px 0; padding-left: 20px; max-height: 100px; overflow-y: auto;">` +
          `    ${playersList || '<li><em>No players yet</em></li>'}` +
          `  </ul>`;
    
    if (this.spectators.size > 0) {
      html += `<strong>Spectators (${this.spectators.size}):</strong>` +
           ` <ul style="margin: 5px 0; padding-left: 20px; max-height: 60px; overflow-y: auto;">` +
         `     ${spectatorsList}` +
         `   </ul>`;
    }
    
    html += `</div></div><div style="text-align: center;">` +
        `  <button name="send" value="/safari join" style="background: #10b981; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Join Game</button>` +
       `   <button name="send" value="/safari spectate" style="background: #6b7280; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Spectate</button>` +
      `    <button name="send" value="/safari start" style="background: #dc2626; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Start Game</button>` +
        `</div></div>`;

    return html;
  }

  // Generate game status UI HTML
  private getGameHTML(): string {
    const currentPlayer = this.turnOrder.length > 0 ? 
      this.participants.get(this.turnOrder[this.turnIndex]) : null;
    
    const playersList = [...this.participants.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => {
        const teamSuffix = this.mode === 'team' ? 
          ` <span style="color: #6b7280;">[${this.teamAssignments.get(p.user.id)}]</span>` : '';
        const isActive = this.mode !== 'blitz' && currentPlayer && p.user.id === currentPlayer.user.id;
        const activeStyle = isActive ? 'background: #fef3c7; font-weight: bold;' : '';
        
        let row = ` <tr style="${activeStyle}">` +
         `   <td>${i + 1}</td>` +
         `   <td>${p.user.name}${teamSuffix} ${isActive ? 'ðŸ'ˆ' : ''}</td>` +
          `  <td>${p.balls}</td>` +
          `  <td>${p.score}</td>`;
        
        if (this.mode !== 'blitz') {
          row += `<td>${Math.ceil(p.timeBank / 1000)}s</td>`;
        }
        
        row += `</tr>`;
        
        return row;
      })
      .join('');

    let html = `<div style="border: 2px solid #059669; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);">` +
        `<h3 style="margin: 0 0 15px 0; color: #059669;">ðŸŽ® Safari Zone Active - ${this.mode.toUpperCase()} Mode</h3>`;

    if (this.mode !== 'blitz' && currentPlayer) {
      html += `<div style="background: #fbbf24; color: #92400e; padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center;">` +
          `<strong>ðŸŽ¯ ${currentPlayer.user.name}'s Turn!</strong> ` +
       `   <span style="margin-left: 10px;">Time Bank: ${Math.ceil(currentPlayer.timeBank / 1000)}s | Balls: ${currentPlayer.balls}</span>` +
        `  <div style="margin-top: 8px;">` +
       `     <button name="send" value="/safari catch" style="background: #dc2626; color: white; border: none; padding: 8px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">ðŸŽ¯ Catch PokÃ©mon!</button>` +
        `  </div> </div>`;
    }

    if (this.mode === 'blitz') {
      html += `<div style="background: #ef4444; color: white; padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center;">` +
        `  <strong>âš¡ BLITZ MODE ACTIVE!</strong>` +
      `    <div style="margin-top: 8px;">` +
      `      <button name="send" value="/safari catch" style="background: #b91c1c; color: white; border: none; padding: 8px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">âš¡ Quick Catch!</button>` +
       `   </div> </div>`;
    }

    html += `  <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">` +
        `  <thead>` +
     `       <tr style="background: #f3f4f6;">` +
    `          <th style="padding: 8px; border: 1px solid #d1d5db;">Rank</th>` +
        `      <th style="padding: 8px; border: 1px solid #d1d5db;">Player</th>` +
         `     <th style="padding: 8px; border: 1px solid #d1d5db;">Balls</th>` +
         `     <th style="padding: 8px; border: 1px solid #d1d5db;">Score</th>`;
    
    if (this.mode !== 'blitz') {
      html += '<th style="padding: 8px; border: 1px solid #d1d5db;">Time Bank</th>';
    }
    
    html += ` </tr> </thead><tbody> ${playersList}  </tbody></table>` +
		 `<div style="text-align: center;">` +
        `  <button name="send" value="/safari status" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; margin: 0 3px; border-radius: 4px; cursor: pointer;">My Status</button>` +
      `    <button name="send" value="/safari leaderboard" style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; margin: 0 3px; border-radius: 4px; cursor: pointer;">Leaderboard</button>` +
      `    <button name="send" value="/safari end" style="background: #dc2626; color: white; border: none; padding: 6px 12px; margin: 0 3px; border-radius: 4px; cursor: pointer;">End Game</button>` +
    `    </div> </div>`;

    return html;
  }

  // Update the UI display
  private updateUI() {
    const html = this.started ? this.getGameHTML() : this.getLobbyHTML();
    this.room.add(`|uhtmlchange|safari-${this.room.id}|${html}`).update();
  }

  // Initial UI creation
  private createUI() {
    const html = this.getLobbyHTML();
    this.room.add(`|uhtml|safari-${this.room.id}|${html}`).update();
  }

  // Add a player
  join(user: User) {
    if (this.started && this.mode !== 'blitz') {
      return user.sendTo(this.room.id, `|error|Game already started.`);
    }
    const uid = user.id;
    if (this.participants.has(uid)) {
      return user.sendTo(this.room.id, `|error|You're already in.`);
    }
    this.participants.set(uid, {
      user, balls: this.ballsPerPlayer,
      score: 0, timeBank: this.timeBankDefault,
    });
    
    user.send(`|pm|&Safari Zone|${user.name}|You have ${this.ballsPerPlayer} balls and ${this.timeBankDefault/1000}s time bank.`);
    this.updateUI();
  }

  // Remove before start
  leave(user: User) {
    if (this.started && this.mode !== 'blitz') {
      return user.sendTo(this.room.id, `|error|Cannot leave after start.`);
    }
    if (!this.participants.delete(user.id)) {
      return user.sendTo(this.room.id, `|error|You're not in the lobby.`);
    }
    this.updateUI();
  }

  // Allow spectators
  spectate(user: User) {
    if (this.participants.has(user.id)) {
      return user.sendTo(this.room.id, `|error|Players cannot spectate.`);
    }
    this.spectators.add(user.id);
    user.send(`|pm|&Safari Zone|${user.name}|You're now spectating. Enjoy!`);
    this.updateUI();
  }

  // Start game
  start(user: User) {
    if (user.id !== this.host.id) {
      return user.sendTo(this.room.id, `|error|Only host can start.`);
    }
    if (this.started) {
      return user.sendTo(this.room.id, `|error|Already started.`);
    }
    if (!this.participants.size) {
      return user.sendTo(this.room.id, `|error|No players joined.`);
    }
    this.started = true;

    // For team mode, assign two teams
    if (this.mode === 'team') {
      const ids = [...this.participants.keys()];
      ids.sort(() => Math.random() - 0.5);
      ids.forEach((uid, idx) => {
        const team = idx % 2 === 0 ? 'Team A' : 'Team B';
        this.teamAssignments.set(uid, team);
      });
    }

    // Blitz global timer
    if (this.mode === 'blitz') {
      this.timer = setTimeout(() => this.end(), this.blitzDuration);
      this.updateUI();
      return;
    }

    // Initialize turn order
    this.turnOrder = [...this.participants.keys()];
    this.turnIndex = 0;
    this.updateUI();
    this.nextTurn();
  }

  // Process a catch action
  catch(user: User) {
    if (!this.started) {
      return user.sendTo(this.room.id, `|error|Game hasn't started.`);
    }
    const uid = user.id;

    // Blitz mode: any time
    if (this.mode === 'blitz') {
      this.processCatch(uid, this.autoEncounter());
      this.updateUI();
      return;
    }

    // Normal/team: turn-based
    const current = this.turnOrder[this.turnIndex];
    if (uid !== current) {
      return user.sendTo(this.room.id, `|error|Not your turn.`);
    }

    // Clear timers
    this.clearTimers();
    this.saveTimeBank();

    this.processCatch(uid, this.randomEncounter());
    this.stepTurn();
  }

  // Core catch logic
  private processCatch(uid: string, speciesName: string) {
    const entry = this.participants.get(uid)!;
    // 1) Prevent underflow
    if (entry.balls <= 0) {
      return entry.user.sendTo(this.room.id, `|error|No balls left.`);
    }
    entry.balls--;

    // 2) Lookup and sum BST
    const species = Dex.species.get(speciesName);
    const bst = Object
      .values(species.baseStats)
      .reduce((sum, val) => sum + val, 0);
    entry.score += bst;

    // 3) Only append a team tag when in team mode
    const teamSuffix = this.mode === 'team'
      ? ` [${this.teamAssignments.get(uid)}]`
      : '';

    // 4) Build the catch message
    let catchMessage = `|raw|<div style="background: #10b981; color: white; padding: 8px; border-radius: 5px; margin: 5px 0;">`;
    catchMessage += `<strong>âœ¨ ${entry.user.name}${teamSuffix}</strong> caught <strong>${species.name}</strong> `;
    catchMessage += `(BST ${bst})! <em>${entry.balls} balls remaining</em></div>`;
    
    this.room.add(catchMessage);

    // 5) Notify spectators
    for (const sid of this.spectators) {
      const spectator = this.room.server.getUser(sid);
      if (spectator) {
        let spectatorMessage = `|pm|&Safari Spectate|${spectator.name}|`;
        spectatorMessage += `${entry.user.name} caught ${species.name}.`;
        spectator.send(spectatorMessage);
      }
    }
  }

  // Skip/auto-catch on timeout
  private onTimeout() {
    const uid = this.turnOrder[this.turnIndex];
    const entry = this.participants.get(uid)!;

    // Calculate used time
    this.saveTimeBank();

    if (entry.balls > 0) {
      // Auto-catch lowest-tier common
      const speciesName = this.autoEncounter();
      this.processCatch(uid, speciesName);
    }
    
    let timeoutMessage = `|raw|<div style="background: #f59e0b; color: white; padding: 6px; border-radius: 4px; margin: 5px 0;">`;
    timeoutMessage += `â° <strong>${entry.user.name}</strong> timed out and auto-caught!</div>`;
    
    this.room.add(timeoutMessage);
    
    this.stepTurn();
  }

  // Advance turn or end
  private stepTurn() {
    this.clearTimers();
    // Remove players with no balls
    this.turnOrder = this.turnOrder.filter(id => this.participants.get(id)!.balls > 0);
    if (!this.turnOrder.length) return this.end();
    this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
    this.nextTurn();
  }

  // Begin next turn: warning + timeout
  private nextTurn() {
    const uid = this.turnOrder[this.turnIndex];
    const entry = this.participants.get(uid)!;

    // If no time left, skip them
    if (entry.timeBank <= 0) {
      this.onTimeout();
      return;
    }

    this.turnStartTime = Date.now();
    this.updateUI();

    // Warning 10s before per-turn timeout
    const warnTime = Math.max(0, this.turnTimeout - 10_000);
    this.warningTimer = setTimeout(() => {
      entry.user.send(`|pm|&Safari Zone|${entry.user.name}|âš ï¸ 10s left to act!`);
    }, warnTime);

    // Main timeout
    this.timer = setTimeout(() => this.onTimeout(), this.turnTimeout);
  }

  // Save time used this turn
  private saveTimeBank() {
    const used = Date.now() - this.turnStartTime;
    const uid = this.turnOrder[this.turnIndex];
    const entry = this.participants.get(uid)!;
    entry.timeBank = Math.max(0, entry.timeBank - used);
  }

  // End or cancel
  end() {
    this.clearTimers();
    if (this.started) {
      // Compute standings
      const standings = [...this.participants.values()]
        .sort((a, b) => b.score - a.score)
        .map((p, i) => {
          const teamSuffix = this.mode === 'team'
            ? ` [${this.teamAssignments.get(p.user.id)}]`
            : '';
          return `<tr><td>${i + 1}</td><td>${p.user.name}${teamSuffix}</td><td>${p.score}</td></tr>`;
        });

      let resultsMessage = `|uhtml|safari-results-${this.room.id}|<div style="border: 2px solid #dc2626; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);">`;
      resultsMessage += `<h3 style="margin: 0 0 15px 0; color: #dc2626;">ðŸ† Safari Zone Complete!</h3>`;
      resultsMessage += `<table style="width: 100%; border-collapse: collapse;">`;
      resultsMessage += `<thead><tr style="background: #f3f4f6;"><th style="padding: 8px; border: 1px solid #d1d5db;">Rank</th><th style="padding: 8px; border: 1px solid #d1d5db;">Player</th><th style="padding: 8px; border: 1px solid #d1d5db;">Final Score</th></tr></thead>`;
      resultsMessage += `<tbody>${standings.join('')}</tbody>`;
      resultsMessage += `</table></div>`;

      this.room.add(resultsMessage);
    } else {
      let cancelMessage = `|uhtml|safari-cancelled-${this.room.id}|<div style="background: #f59e0b; color: white; padding: 15px; border-radius: 10px; text-align: center;">`;
      cancelMessage += `<h3 style="margin: 0;">ðŸš« Safari Zone Cancelled</h3></div>`;
      
      this.room.add(cancelMessage);
    }
    
    // Clear the main UI
    this.room.add(`|uhtmlchange|safari-${this.room.id}|`).update();
  }

  // Initialize the game UI
  create() {
    this.createUI();
  }

  // Weighted random encounter by rarity
  private randomEncounter(): string {
    const all = Dex.species.all().filter(s => !s.isNonstandard);
    const tiers = { common: [] as string[], uncommon: [] as string[], rare: [] as string[] };

    all.forEach(s => {
      const bst = Object.values(s.baseStats).reduce((a, b) => a + b, 0);
      if (bst < 350) tiers.common.push(s.name);
      else if (bst < 500) tiers.uncommon.push(s.name);
      else tiers.rare.push(s.name);
    });

    const roll = Math.random();
    if (roll < 0.6) return this.randomItem(tiers.common);
    if (roll < 0.9) return this.randomItem(tiers.uncommon);
    return this.randomItem(tiers.rare);
  }

  // Lowest-tier common for auto-catch
  private autoEncounter(): string {
    const common = Dex.species.all()
      .filter(s => {
        const bst = Object.values(s.baseStats).reduce((a, b) => a + b, 0);
        return bst < 350 && !s.isNonstandard;
      })
      .sort((a, b) => {
        const ba = Object.values(a.baseStats).reduce((x, y) => x + y, 0);
        const bb = Object.values(b.baseStats).reduce((x, y) => x + y, 0);
        return ba - bb;
      })
      .map(s => s.name);
    // Pick lowest 5 or full list
    const pool = common.slice(0, Math.min(common.length, 5));
    return this.randomItem(pool);
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.warningTimer) clearTimeout(this.warningTimer);
    this.timer = this.warningTimer = null;
  }

  private randomItem<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}
