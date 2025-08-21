/* server/chat-plugins/safari-game.ts
 *
 * Safari Game Class - Core game logic with integrated uhtml UI
 * Fixed: Removed all spectate functionality
 * Fixed: Game cleanup now properly removes from safariGames map
 * Fixed: Status and leaderboard are now integrated into main UI and always display below
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
  turnOrder: string[] = [];
  turnIndex = 0;
  timer: NodeJS.Timeout | null = null;
  warningTimer: NodeJS.Timeout | null = null;
  turnStartTime = 0;
  started = false;
  teamAssignments: Map<string, string> = new Map(); // user.id -> team name
  // Add cleanup callback
  onGameEnd?: () => void;
  // Store recent catches for UI display
  recentCatches: Array<{
    playerName: string;
    teamSuffix: string;
    pokemonName: string;
    bst: number;
    ballsLeft: number;
    isTimeout: boolean;
    timestamp: number;
  }> = [];
  maxRecentCatches = 3; // Show last 3 catches
  
  // Track what sections are currently shown
  private showingStatus = false;
  private showingLeaderboard = false;
  private statusForUser: string = ''; // Track which user's status is being shown

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

    let html = `<div style="border: 2px solid #4CAF50; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);">` +
        `<h3 style="margin: 0 0 10px 0; color: #2563eb;">🌿 Safari Zone Lobby</h3>` +
        `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px;">` +
          `<div>` +
            `<strong>Game Settings:</strong>` +
            `<ul style="margin: 5px 0; padding-left: 20px;">` +
              `<li>Host: <strong>${this.host.name}</strong></li>` +
              `<li>Mode: <strong>${this.mode}</strong></li>` +
              `<li>Balls: <strong>${this.ballsPerPlayer}</strong></li>`;
    
    if (this.mode !== 'blitz') {
      html += `<li>Turn timeout: <strong>${this.turnTimeout / 1000}s</strong></li>` +
                `<li>Time bank: <strong>${this.timeBankDefault / 1000}s</strong></li>`;
    } else {
      html += `<li>Blitz duration: <strong>${this.blitzDuration / 1000}s</strong></li>`;
    }
    
    html += `</ul></div>` +
          `<div><strong>Players (${this.participants.size}):</strong>` +
            `<ul style="margin: 5px 0; padding-left: 20px; max-height: 100px; overflow-y: auto;">` +
              `${playersList || '<li><em>No players yet</em></li>'}` +
            `</ul></div></div>` +
        `<div style="text-align: center;">` +
          `<button name="send" value="/safari join" style="background: #10b981; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Join Game</button>` +
          `<button name="send" value="/safari start" style="background: #dc2626; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Start Game</button>` +
        `</div></div>`;

    return html;
  }

	// Generate game status UI HTML
private getGameHTML(): string {
  const currentPlayer = this.turnOrder.length > 0 ? 
    this.participants.get(this.turnOrder[this.turnIndex]) : null;

	const playersList = [...this.participants.values()]
  .sort((a, b) => b.score - a.score)
  .slice(0, 3) // Only show top 3 players
  .map((p, i) => {
    const teamSuffix = this.mode === 'team' ? 
      ` <span style="color: #6b7280;">[${this.teamAssignments.get(p.user.id)}]</span>` : '';
    const isActive = this.mode !== 'blitz' && currentPlayer && p.user.id === currentPlayer.user.id;
    const activeStyle = isActive ? 'background: #fef3c7; font-weight: bold;' : '';
    
    // Show medal for top 3
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
    
    let row = `<tr style="${activeStyle}">` +
        `<td style="text-align: center; font-size: 18px;">${medal}</td>` +
        `<td>${p.user.name}${teamSuffix} ${isActive ? '⭐' : ''}</td>` +
        `<td>${p.balls}</td>` +
        `<td>${p.score}</td>`;
    
    if (this.mode !== 'blitz') {
      row += `<td>${Math.ceil(p.timeBank / 1000)}s</td>`;
    }
    
    row += `</tr>`;
    
    return row;
  })
  .join('');

  // Generate recent catches display
  const recentCatchesHTML = this.recentCatches.length > 0 ? 
    `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin: 10px 0;">` +
      `<h4 style="margin: 0 0 8px 0; color: #475569; font-size: 14px;">📜 Recent Catches</h4>` +
      `<div style="max-height: 120px; overflow-y: auto;">` +
        this.recentCatches.slice().reverse().map(catch_ => {
          const bgColor = catch_.isTimeout ? '#fef3c7' : '#d1fae5';
          const textColor = catch_.isTimeout ? '#92400e' : '#065f46';
          const icon = catch_.isTimeout ? '⏰' : '✨';
          return `<div style="background: ${bgColor}; color: ${textColor}; padding: 4px 8px; margin: 2px 0; border-radius: 4px; font-size: 12px;">` +
                 `<strong>${icon} ${catch_.playerName}${catch_.teamSuffix}</strong> caught <strong>${catch_.pokemonName}</strong> ` +
                 `(BST ${catch_.bst}) • ${catch_.ballsLeft} balls left</div>`;
        }).join('') +
      `</div>` +
    `</div>` : '';

  let html = `<div style="border: 2px solid #059669; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);">` +
      `<h3 style="margin: 0 0 15px 0; color: #059669;">🎮 Safari Zone Active - ${this.mode.toUpperCase()} Mode</h3>`;

  if (this.mode !== 'blitz' && currentPlayer) {
    html += `<div style="background: #fbbf24; color: #92400e; padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center;">` +
        `<strong>🎯 ${currentPlayer.user.name}'s Turn!</strong> ` +
        `<span style="margin-left: 10px;">Time Bank: ${Math.ceil(currentPlayer.timeBank / 1000)}s | Balls: ${currentPlayer.balls}</span>` +
        `<div style="margin-top: 8px;">` +
          `<button name="send" value="/safari catch" style="background: #dc2626; color: white; border: none; padding: 8px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">🎾 Catch Pokémon!</button>` +
        `</div></div>`;
  }

  if (this.mode === 'blitz') {
    html += `<div style="background: #ef4444; color: white; padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center;">` +
        `<strong>⚡ BLITZ MODE ACTIVE!</strong>` +
        `<div style="margin-top: 8px;">` +
          `<button name="send" value="/safari catch" style="background: #b91c1c; color: white; border: none; padding: 8px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">⚡ Quick Catch!</button>` +
        `</div></div>`;
  }

  // Add recent catches section
  html += recentCatchesHTML;

  html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">` +
    `<thead>` +
      `<tr style="background: #f3f4f6;">` +
        `<th style="padding: 8px; border: 1px solid #d1d5db;">Top 3</th>` +
        `<th style="padding: 8px; border: 1px solid #d1d5db;">Player</th>` +
        `<th style="padding: 8px; border: 1px solid #d1d5db;">Balls</th>` +
        `<th style="padding: 8px; border: 1px solid #d1d5db;">Score</th>`;
	
  if (this.mode !== 'blitz') {
    html += '<th style="padding: 8px; border: 1px solid #d1d5db;">Time Bank</th>';
  }
  
  html += `</tr></thead><tbody>${playersList}</tbody></table>` +
      `<div style="text-align: center;">` +
        `<button name="send" value="/safari status" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; margin: 0 3px; border-radius: 4px; cursor: pointer;">My Status</button>` +
        `<button name="send" value="/safari leaderboard" style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; margin: 0 3px; border-radius: 4px; cursor: pointer;">Leaderboard</button>` +
        `<button name="send" value="/safari end" style="background: #dc2626; color: white; border: none; padding: 6px 12px; margin: 0 3px; border-radius: 4px; cursor: pointer;">End Game</button>` +
      `</div></div>`;

  return html;
}

  // Update the UI display
	private updateUI() {
		if (this.started) {
			// Show game UI only to participants
			const gameHTML = this.getGameHTML();
			const stickyGameHtml = `<div class="safari-sticky" style="position: sticky; bottom: 0; z-index: 1000; background: white; border-top: 2px solid #ddd;">${gameHTML}</div>`;
			
			// Send game UI to each participant
			for (const [uid, participant] of this.participants) {
				participant.user.sendTo(this.room.id, `|uhtmlchange|safari-${this.room.id}|${stickyGameHtml}`);
			}
			
			// Show inactive game display for non-participants
			const inactiveHTML = this.getInactiveGameHTML();
			const stickyInactiveHtml = `<div class="safari-sticky" style="position: sticky; bottom: 0; z-index: 1000; background: white; border-top: 2px solid #ddd;">${inactiveHTML}</div>`;
			
			// Send to all users in room who aren't participants
			for (const user of this.room.users.values()) {
				if (!this.participants.has(user.id)) {
					user.sendTo(this.room.id, `|uhtmlchange|safari-${this.room.id}|${stickyInactiveHtml}`);
				}
			}
		} else {
			// Show lobby to everyone
			const html = this.getLobbyHTML();
			const stickyHtml = `<div class="safari-sticky" style="position: sticky; bottom: 0; z-index: 1000; background: white; border-top: 2px solid #ddd;">${html}</div>`;
			this.room.add(`|uhtmlchange|safari-${this.room.id}|${stickyHtml}`).update();
		}
	}
	
  // Generate inactive game display for non-participants
  private getInactiveGameHTML(): string {
    const playerCount = this.participants.size;
    const topPlayer = [...this.participants.values()]
      .sort((a, b) => b.score - a.score)[0];
    
    return `<div style="border: 2px solid #6b7280; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%); opacity: 0.8;">` +
      `<h3 style="margin: 0 0 10px 0; color: #6b7280;">🎮 Safari Zone In Progress</h3>` +
      `<div style="text-align: center; color: #6b7280;">` +
        `<p style="margin: 5px 0;">Mode: <strong>${this.mode.toUpperCase()}</strong> | Players: <strong>${playerCount}</strong></p>` +
        `${topPlayer ? `<p style="margin: 5px 0;">Current Leader: <strong>${topPlayer.user.name}</strong> (${topPlayer.score} BST)</p>` : ''}` +
        `<p style="margin: 5px 0; font-style: italic;">Game is active - only participants can see the action!</p>` +
      `</div>` +
    `</div>`;
  }

	// Show status for a specific user - called from command
showStatus(user: User) {
  const p = this.participants.get(user.id);
  if (!p) {
    return false;
  }

  const statusHTML = 
    `<div style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); padding: 15px; border-radius: 10px; border: 2px solid #0284c7;">` +
    `<h4 style="margin: 0 0 10px 0; color: #0c4a6e;">🎯 ${user.name}'s Safari Status</h4>` +
    `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">` +
      `<div><strong>🎾 Poké Balls:</strong> ${p.balls}</div>` +
      `<div><strong>🏆 Score:</strong> ${p.score} BST</div>` +
      `<div><strong>⏱️ Time Bank:</strong> ${Math.ceil(p.timeBank / 1000)}s</div>` +
      `<div><strong>🎮 Mode:</strong> ${this.mode}</div>` +
    `</div>` +
    `${this.mode === 'team' && this.teamAssignments.has(user.id) ? 
      `<div style="margin-top: 10px; text-align: center; color: #1e40af;"><strong>Team: ${this.teamAssignments.get(user.id)}</strong></div>` : ''
    }` +
    `<div style="text-align: center; margin-top: 10px;">` +
      `<button name="send" value="/safari status" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">🔄 Refresh</button>` +
    `</div>` +
    `</div>`;

  // Send status only to the requesting user
  user.sendTo(this.room.id, `|uhtml|safari-status-${user.id}|${statusHTML}`);
  return true;
}

// Show leaderboard - called from command
showLeaderboard(user: User) {
  const standings = [...this.participants.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => {
      const teamSuffix = this.mode === 'team' && this.teamAssignments.has(p.user.id)
        ? ` <span style="color: #6b7280;">[${this.teamAssignments.get(p.user.id)}]</span>`
        : '';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      
      return `<tr style="${i < 3 ? 'background: #fef3c7;' : ''}">` +
          `<td style="text-align: center; font-size: 18px;">${medal}</td>` +
          `<td><strong>${p.user.name}</strong>${teamSuffix}</td>` +
          `<td style="text-align: center;">${p.balls}</td>` +
          `<td style="text-align: center; color: #dc2626; font-weight: bold;">${p.score}</td>` +
          `${this.mode !== 'blitz' ? `<td style="text-align: center;">${Math.ceil(p.timeBank / 1000)}s</td>` : ''}` +
        `</tr>`;
    })
    .join('');

  const leaderboardHTML = 
    `<div style="background: linear-gradient(135deg, #fef7cd 0%, #fde68a 100%); padding: 15px; border-radius: 10px; border: 2px solid #d97706;">` +
    `<h3 style="margin: 0 0 15px 0; color: #92400e; text-align: center;">🏆 Safari Zone Leaderboard</h3>` +
    `<table style="width: 100%; border-collapse: collapse;">` +
      `<thead>` +
        `<tr style="background: #f59e0b; color: white;">` +
          `<th style="padding: 10px; border: 1px solid #d97706;">Rank</th>` +
          `<th style="padding: 10px; border: 1px solid #d97706;">Player</th>` +
          `<th style="padding: 10px; border: 1px solid #d97706;">Balls</th>` +
          `<th style="padding: 10px; border: 1px solid #d97706;">Score (BST)</th>` +
          `${this.mode !== 'blitz' ? `<th style="padding: 10px; border: 1px solid #d97706;">Time Bank</th>` : ''}` +
        `</tr>` +
      `</thead>` +
      `<tbody>${standings}</tbody>` +
    `</table>` +
    `<div style="text-align: center; margin-top: 10px;">` +
      `<button name="send" value="/safari leaderboard" style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">🔄 Refresh</button>` +
    `</div>` +
    `</div>`;

  // Send leaderboard only to the requesting user
  user.sendTo(this.room.id, `|uhtml|safari-leaderboard-${user.id}|${leaderboardHTML}`);
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

    // Reset UI state when starting
    this.showingStatus = false;
    this.showingLeaderboard = false;
    this.statusForUser = '';

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
      this.processCatch(uid, this.autoEncounter(), false);
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

    this.processCatch(uid, this.randomEncounter(), false);
    this.stepTurn();
  }

  // Core catch logic
  private processCatch(uid: string, speciesName: string, isTimeout: boolean = false) {
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

    // 4) Add to recent catches instead of room chat
    this.recentCatches.push({
      playerName: entry.user.name,
      teamSuffix,
      pokemonName: species.name,
      bst,
      ballsLeft: entry.balls,
      isTimeout,
      timestamp: Date.now()
    });

    // Keep only the most recent catches
    if (this.recentCatches.length > this.maxRecentCatches) {
      this.recentCatches = this.recentCatches.slice(-this.maxRecentCatches);
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
      this.processCatch(uid, speciesName, true); // Mark as timeout catch
    }
    
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
      entry.user.send(`|pm|&Safari Zone|${entry.user.name}|⚠️ 10s left to act!`);
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

	// End or cancel - FIXED: Now calls cleanup callback and clears all UIs
end() {
  this.clearTimers();
  
  // Clear individual user status and leaderboard UIs before ending
  for (const [uid, participant] of this.participants) {
    const user = participant.user;
    // Clear individual status and leaderboard elements
    user.sendTo(this.room.id, `|uhtmlchange|safari-status-${user.id}|`);
    user.sendTo(this.room.id, `|uhtmlchange|safari-leaderboard-${user.id}|`);
  }
  
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
    resultsMessage += `<h3 style="margin: 0 0 15px 0; color: #dc2626;">🏁 Safari Zone Complete!</h3>`;
    resultsMessage += `<table style="width: 100%; border-collapse: collapse;">`;
    resultsMessage += `<thead><tr style="background: #f3f4f6;"><th style="padding: 8px; border: 1px solid #d1d5db;">Rank</th><th style="padding: 8px; border: 1px solid #d1d5db;">Player</th><th style="padding: 8px; border: 1px solid #d1d5db;">Final Score</th></tr></thead>`;
    resultsMessage += `<tbody>${standings.join('')}</tbody>`;
    resultsMessage += `</table></div>`;

    // Show results to everyone in the room
    this.room.add(resultsMessage);
  } else {
    let cancelMessage = `|uhtml|safari-cancelled-${this.room.id}|<div style="background: #f59e0b; color: white; padding: 15px; border-radius: 10px; text-align: center;">`;
    cancelMessage += `<h3 style="margin: 0;">🚫 Safari Zone Cancelled</h3></div>`;
    
    this.room.add(cancelMessage);
  }
  
  // Clear the main UI for everyone
  this.room.add(`|uhtmlchange|safari-${this.room.id}|`);
  
  this.room.update();
  
  // FIXED: Call cleanup callback to remove from safariGames map
  if (this.onGameEnd) {
    this.onGameEnd();
  }
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