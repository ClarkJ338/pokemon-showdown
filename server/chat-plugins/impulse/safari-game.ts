/* server/chat-plugins/safari-game.ts
 *
 * Safari Game Class - Core game logic with Chat.pages integration
 * - Game lobby displays in chatroom via uhtml
 * - Game status, leaderboard, and player status use Chat.pages
 * - Recent catches and detailed info moved to dedicated pages
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
  onGameEnd?: () => void;
  
  // Store recent catches for display
  recentCatches: Array<{
    playerName: string;
    teamSuffix: string;
    pokemonName: string;
    bst: number;
    ballsLeft: number;
    isTimeout: boolean;
    timestamp: number;
  }> = [];
  maxRecentCatches = 10;

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

  // Generate lobby UI HTML (stays in chatroom)
  private getLobbyHTML(): string {
    const playersList = [...this.participants.values()]
      .map(p => `<li>${p.user.name}</li>`)
      .join('');
    
    const spectatorsList = [...this.spectators]
      .map(uid => {
        const participant = this.participants.get(uid);
        return participant ? `<li>${participant.user.name}</li>` : '';
      })
      .filter(Boolean)
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
            `</ul>`;
    
    if (this.spectators.size > 0) {
      html += `<strong>Spectators (${this.spectators.size}):</strong>` +
            `<ul style="margin: 5px 0; padding-left: 20px; max-height: 60px; overflow-y: auto;">` +
              `${spectatorsList}` +
            `</ul>`;
    }
    
    html += `</div></div>` +
        `<div style="text-align: center; margin-bottom: 10px;">` +
          `<button name="send" value="/safari join" style="background: #10b981; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Join Game</button>` +
          `<button name="send" value="/safari spectate" style="background: #6b7280; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Spectate</button>` +
          `<button name="send" value="/safari start" style="background: #dc2626; color: white; border: none; padding: 8px 16px; margin: 0 5px; border-radius: 5px; cursor: pointer;">Start Game</button>` +
        `</div>` +
        `<div style="text-align: center; padding: 8px; background: #e0f2fe; border-radius: 5px;">` +
          `<small>📱 Once started, use <strong>/safari game</strong> to view the game page!</small>` +
        `</div>` +
      `</div>`;

    return html;
  }

  // Minimal game started notification for chatroom
  private getGameStartedHTML(): string {
    const currentPlayer = this.turnOrder.length > 0 ? 
      this.participants.get(this.turnOrder[this.turnIndex]) : null;

    let html = `<div style="border: 2px solid #059669; border-radius: 10px; padding: 15px; margin: 10px 0; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);">` +
      `<h3 style="margin: 0 0 15px 0; color: #059669;">🎮 Safari Zone Active - ${this.mode.toUpperCase()} Mode</h3>`;

    if (this.mode !== 'blitz' && currentPlayer) {
      html += `<div style="background: #fbbf24; color: #92400e; padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center;">` +
          `<strong>🎯 ${currentPlayer.user.name}'s Turn!</strong> ` +
          `<span style="margin-left: 10px;">Time Bank: ${Math.ceil(currentPlayer.timeBank / 1000)}s | Balls: ${currentPlayer.balls}</span>` +
        `</div>`;
    }

    html += `<div style="text-align: center;">` +
        `<button name="send" value="/safari game" style="background: #059669; color: white; border: none; padding: 12px 24px; margin: 0 8px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">🎮 Open Game Page</button>` +
        `<button name="send" value="/safari catch" style="background: #dc2626; color: white; border: none; padding: 12px 24px; margin: 0 8px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">🎾 Quick Catch</button>` +
      `</div>` +
      `<div style="margin-top: 10px; text-align: center;">` +
        `<small style="color: #059669;">Players: ${this.participants.size} | Use /safari game for full interface</small>` +
      `</div>` +
    `</div>`;

    return html;
  }

  // Update the chatroom UI
  private updateUI() {
    const html = this.started ? this.getGameStartedHTML() : this.getLobbyHTML();
    this.room.add(`|uhtmlchange|safari-${this.room.id}|${html}`).update();
  }
  
  // Initial UI creation
  private createUI() {
    const html = this.getLobbyHTML();
    this.room.add(`|uhtml|safari-${this.room.id}|${html}`).update();
  }

  // Generate main game page content for Chat.pages
  private getGamePageHTML(): string {
    const currentPlayer = this.turnOrder.length > 0 ? 
      this.participants.get(this.turnOrder[this.turnIndex]) : null;

    const playersList = [...this.participants.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => {
        const teamSuffix = this.mode === 'team' ? 
          ` <span style="color: #6b7280;">[${this.teamAssignments.get(p.user.id)}]</span>` : '';
        const isActive = this.mode !== 'blitz' && currentPlayer && p.user.id === currentPlayer.user.id;
        const activeStyle = isActive ? 'background: #fef3c7; font-weight: bold;' : '';
        
        // Show rank for all players
        const rank = i + 1;
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${rank}.`;
        
        let row = `<tr style="${activeStyle}">` +
            `<td style="text-align: center; font-size: 16px; padding: 8px;">${medal}</td>` +
            `<td style="padding: 8px;">${p.user.name}${teamSuffix} ${isActive ? '⭐' : ''}</td>` +
            `<td style="text-align: center; padding: 8px;">${p.balls}</td>` +
            `<td style="text-align: center; padding: 8px; color: #dc2626; font-weight: bold;">${p.score}</td>`;
        
        if (this.mode !== 'blitz') {
          row += `<td style="text-align: center; padding: 8px;">${Math.ceil(p.timeBank / 1000)}s</td>`;
        }
        
        row += `</tr>`;
        return row;
      })
      .join('');

    // Recent catches section
    const recentCatchesHTML = this.recentCatches.length > 0 ? 
      `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 20px 0;">` +
        `<h4 style="margin: 0 0 12px 0; color: #475569; font-size: 16px;">📜 Recent Catches</h4>` +
        `<div style="max-height: 200px; overflow-y: auto;">` +
          this.recentCatches.slice().reverse().map(catch_ => {
            const bgColor = catch_.isTimeout ? '#fef3c7' : '#d1fae5';
            const textColor = catch_.isTimeout ? '#92400e' : '#065f46';
            const icon = catch_.isTimeout ? '⏰' : '✨';
            const timeAgo = Math.floor((Date.now() - catch_.timestamp) / 1000);
            return `<div style="background: ${bgColor}; color: ${textColor}; padding: 8px 12px; margin: 4px 0; border-radius: 6px; font-size: 14px;">` +
                   `<strong>${icon} ${catch_.playerName}${catch_.teamSuffix}</strong> caught <strong>${catch_.pokemonName}</strong> ` +
                   `(BST ${catch_.bst}) • ${catch_.ballsLeft} balls left • ${timeAgo}s ago</div>`;
          }).join('') +
        `</div>` +
      `</div>` : '';

    let html = `<div style="max-width: 1200px; margin: 0 auto; padding: 20px;">` +
      `<div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #059669; border-radius: 15px; padding: 20px; margin-bottom: 20px;">` +
        `<h2 style="margin: 0 0 20px 0; color: #059669; text-align: center;">🎮 Safari Zone - ${this.mode.toUpperCase()} Mode</h2>`;

    // Current turn indicator
    if (this.mode !== 'blitz' && currentPlayer) {
      html += `<div style="background: #fbbf24; color: #92400e; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center;">` +
          `<h3 style="margin: 0 0 10px 0;">🎯 ${currentPlayer.user.name}'s Turn!</h3>` +
          `<div style="font-size: 16px;">Time Bank: <strong>${Math.ceil(currentPlayer.timeBank / 1000)}s</strong> | Balls: <strong>${currentPlayer.balls}</strong></div>` +
          `<div style="margin-top: 15px;">` +
            `<button name="send" value="/safari catch" style="background: #dc2626; color: white; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">🎾 Catch Pokémon!</button>` +
          `</div>` +
        `</div>`;
    } else if (this.mode === 'blitz') {
      html += `<div style="background: #ef4444; color: white; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center;">` +
          `<h3 style="margin: 0 0 10px 0;">⚡ BLITZ MODE ACTIVE!</h3>` +
          `<div style="margin-top: 15px;">` +
            `<button name="send" value="/safari catch" style="background: #b91c1c; color: white; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">⚡ Quick Catch!</button>` +
          `</div>` +
        `</div>`;
    }

    // Player standings table
    html += `<div style="background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px;">` +
        `<h3 style="margin: 0 0 15px 0; color: #374151;">🏆 Current Standings</h3>` +
        `<table style="width: 100%; border-collapse: collapse;">` +
          `<thead>` +
            `<tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">` +
              `<th style="padding: 12px; text-align: center;">Rank</th>` +
              `<th style="padding: 12px; text-align: left;">Player</th>` +
              `<th style="padding: 12px; text-align: center;">Balls</th>` +
              `<th style="padding: 12px; text-align: center;">Score (BST)</th>` +
              `${this.mode !== 'blitz' ? '<th style="padding: 12px; text-align: center;">Time Bank</th>' : ''}` +
            `</tr>` +
          `</thead>` +
          `<tbody>${playersList}</tbody>` +
        `</table>` +
      `</div>`;

    // Recent catches
    html += recentCatchesHTML;

    // Action buttons
    html += `<div style="text-align: center; margin-top: 20px;">` +
        `<button name="send" value="/safari status" style="background: #3b82f6; color: white; border: none; padding: 10px 20px; margin: 0 8px; border-radius: 6px; cursor: pointer;">📊 My Status</button>` +
        `<button name="send" value="/safari leaderboard" style="background: #8b5cf6; color: white; border: none; padding: 10px 20px; margin: 0 8px; border-radius: 6px; cursor: pointer;">🏆 Leaderboard</button>` +
        `<button onclick="location.reload()" style="background: #10b981; color: white; border: none; padding: 10px 20px; margin: 0 8px; border-radius: 6px; cursor: pointer;">🔄 Refresh</button>` +
        `<button name="send" value="/safari end" style="background: #dc2626; color: white; border: none; padding: 10px 20px; margin: 0 8px; border-radius: 6px; cursor: pointer;">🛑 End Game</button>` +
      `</div>` +
    `</div></div>`;

    return html;
  }

  // Generate player status page content
  private getStatusPageHTML(user: User): string {
    const p = this.participants.get(user.id);
    if (!p) return '<div>You are not in this game.</div>';

    const teamInfo = this.mode === 'team' && this.teamAssignments.has(user.id) ? 
      `<div style="background: #e0f2fe; padding: 15px; border-radius: 10px; text-align: center; margin-bottom: 20px;">` +
        `<h3 style="margin: 0; color: #1e40af;">Team: ${this.teamAssignments.get(user.id)}</h3>` +
      `</div>` : '';

    return `<div style="max-width: 800px; margin: 0 auto; padding: 20px;">` +
      `<div style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border: 2px solid #0284c7; border-radius: 15px; padding: 20px;">` +
        `<h2 style="margin: 0 0 20px 0; color: #0c4a6e; text-align: center;">🎯 ${user.name}'s Safari Status</h2>` +
        teamInfo +
        `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">` +
          `<div style="background: white; padding: 20px; border-radius: 10px; text-align: center;">` +
            `<div style="font-size: 48px; margin-bottom: 10px;">🎾</div>` +
            `<h3 style="margin: 0; color: #374151;">Poké Balls</h3>` +
            `<div style="font-size: 36px; font-weight: bold; color: #dc2626;">${p.balls}</div>` +
          `</div>` +
          `<div style="background: white; padding: 20px; border-radius: 10px; text-align: center;">` +
            `<div style="font-size: 48px; margin-bottom: 10px;">🏆</div>` +
            `<h3 style="margin: 0; color: #374151;">Score</h3>` +
            `<div style="font-size: 36px; font-weight: bold; color: #059669;">${p.score}</div>` +
          `</div>` +
        `</div>` +
        `<div style="background: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px;">` +
          `<h3 style="margin: 0 0 10px 0; color: #374151;">⏱️ Time Bank</h3>` +
          `<div style="font-size: 24px; font-weight: bold; color: ${p.timeBank > 30000 ? '#059669' : p.timeBank > 10000 ? '#f59e0b' : '#dc2626'};">` +
            `${Math.ceil(p.timeBank / 1000)}s remaining` +
          `</div>` +
        `</div>` +
        `<div style="text-align: center;">` +
          `<button name="send" value="/safari game" style="background: #059669; color: white; border: none; padding: 12px 24px; margin: 0 8px; border-radius: 8px; cursor: pointer; font-weight: bold;">🎮 Back to Game</button>` +
          `<button onclick="location.reload()" style="background: #3b82f6; color: white; border: none; padding: 12px 24px; margin: 0 8px; border-radius: 8px; cursor: pointer;">🔄 Refresh</button>` +
        `</div>` +
      `</div>` +
    `</div>`;
  }

  // Generate leaderboard page content
  private getLeaderboardPageHTML(): string {
    const standings = [...this.participants.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => {
        const teamSuffix = this.mode === 'team' && this.teamAssignments.has(p.user.id)
          ? ` <span style="color: #6b7280;">[${this.teamAssignments.get(p.user.id)}]</span>`
          : '';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        
        return `<tr style="${i < 3 ? 'background: #fef3c7;' : ''}">` +
            `<td style="text-align: center; padding: 12px; font-size: 24px;">${medal}</td>` +
            `<td style="padding: 12px;"><strong>${p.user.name}</strong>${teamSuffix}</td>` +
            `<td style="text-align: center; padding: 12px;">${p.balls}</td>` +
            `<td style="text-align: center; padding: 12px; color: #dc2626; font-weight: bold; font-size: 18px;">${p.score}</td>` +
            `${this.mode !== 'blitz' ? `<td style="text-align: center; padding: 12px;">${Math.ceil(p.timeBank / 1000)}s</td>` : ''}` +
          `</tr>`;
      })
      .join('');

    return `<div style="max-width: 1000px; margin: 0 auto; padding: 20px;">` +
      `<div style="background: linear-gradient(135deg, #fef7cd 0%, #fde68a 100%); border: 2px solid #d97706; border-radius: 15px; padding: 20px;">` +
        `<h2 style="margin: 0 0 20px 0; color: #92400e; text-align: center;">🏆 Safari Zone Leaderboard</h2>` +
        `<div style="background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">` +
          `<table style="width: 100%; border-collapse: collapse;">` +
            `<thead>` +
              `<tr style="background: #f59e0b; color: white;">` +
                `<th style="padding: 15px; border-radius: 8px 0 0 8px;">Rank</th>` +
                `<th style="padding: 15px;">Player</th>` +
                `<th style="padding: 15px;">Balls Left</th>` +
                `<th style="padding: 15px;">Score (BST)</th>` +
                `${this.mode !== 'blitz' ? `<th style="padding: 15px; border-radius: 0 8px 8px 0;">Time Bank</th>` : '<th style="padding: 15px; border-radius: 0 8px 8px 0;"></th>'}` +
              `</tr>` +
            `</thead>` +
            `<tbody>${standings}</tbody>` +
          `</table>` +
        `</div>` +
        `<div style="text-align: center; margin-top: 20px;">` +
          `<button name="send" value="/safari game" style="background: #059669; color: white; border: none; padding: 12px 24px; margin: 0 8px; border-radius: 8px; cursor: pointer; font-weight: bold;">🎮 Back to Game</button>` +
          `<button onclick="location.reload()" style="background: #8b5cf6; color: white; border: none; padding: 12px 24px; margin: 0 8px; border-radius: 8px; cursor: pointer;">🔄 Refresh</button>` +
        `</div>` +
      `</div>` +
    `</div>`;
  }

  // Show game page using Chat.pages
  showGamePage(user: User) {
    if (!this.started) {
      return user.sendTo(this.room.id, `|error|Game hasn't started yet.`);
    }
    
    const html = this.getGamePageHTML();
    user.send(`>view-gamepage-safari-${this.room.id}\n|init|html\n|title|Safari Zone Game\n|pagehtml|${html}`);
  }

  // Show status page using Chat.pages  
  showStatus(user: User) {
    if (!this.participants.has(user.id)) {
      return user.sendTo(this.room.id, `|error|You're not playing.`);
    }
    
    const html = this.getStatusPageHTML(user);
    user.send(`>view-status-safari-${user.id}\n|init|html\n|title|My Safari Status\n|pagehtml|${html}`);
  }

  // Show leaderboard page using Chat.pages
  showLeaderboard(user: User) {
    const html = this.getLeaderboardPageHTML();
    user.send(`>view-leaderboard-safari-${this.room.id}\n|init|html\n|title|Safari Leaderboard\n|pagehtml|${html}`);
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
    
    user.send(`|pm|&Safari Zone|${user.name}|You joined with ${this.ballsPerPlayer} balls and ${this.timeBankDefault/1000}s time bank.`);
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
    user.send(`|pm|&Safari Zone|${user.name}|You're now spectating. Use /safari game to view the game page!`);
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

    // 4) Add to recent catches
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

    // 5) Send a brief notification to the room
    this.room.add(
      `|raw|<div style="background: ${isTimeout ? '#fef3c7' : '#d1fae5'}; color: ${isTimeout ? '#92400e' : '#065f46'}; padding: 6px 12px; border-radius: 4px; margin: 2px 0; text-align: center;">` +
      `${isTimeout ? '⏰' : '✨'} <strong>${entry.user.name}${teamSuffix}</strong> caught <strong>${species.name}</strong> (BST ${bst})${isTimeout ? ' [timeout]' : ''}` +
      `</div>`
    );

    // 6) Update chatroom UI
    this.updateUI();
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
      entry.user.send(`|pm|&Safari Zone|${entry.user.name}|⚠️ 10s left to act! Use /safari game to open the game page.`);
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
      resultsMessage += `<h3 style="margin: 0 0 15px 0; color: #dc2626;">🏁 Safari Zone Complete!</h3>`;
      resultsMessage += `<table style="width: 100%; border-collapse: collapse;">`;
      resultsMessage += `<thead><tr style="background: #f3f4f6;"><th style="padding: 8px; border: 1px solid #d1d5db;">Rank</th><th style="padding: 8px; border: 1px solid #d1d5db;">Player</th><th style="padding: 8px; border: 1px solid #d1d5db;">Final Score</th></tr></thead>`;
      resultsMessage += `<tbody>${standings.join('')}</tbody>`;
      resultsMessage += `</table></div>`;

      this.room.add(resultsMessage);
    } else {
      let cancelMessage = `|uhtml|safari-cancelled-${this.room.id}|<div style="background: #f59e0b; color: white; padding: 15px; border-radius: 10px; text-align: center;">`;
      cancelMessage += `<h3 style="margin: 0;">🚫 Safari Zone Cancelled</h3></div>`;
      
      this.room.add(cancelMessage);
    }
    
    // Clear the main UI
    this.room.add(`|uhtmlchange|safari-${this.room.id}|`);
    
    this.room.update();
    
    // Call cleanup callback to remove from safariGames map
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