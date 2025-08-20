/* server/chat-plugins/safari.ts
 *
 * Advanced Safari Zone Commands:
 * - Turn-based with per-player time bank and timeout warnings
 * - Automated catch on timeout (low-BST common Pokémon)
 * - Wild encounters weighted by rarity tiers
 * - Spectator mode
 * - Optional team or blitz modes
 * - Enhanced UI with |uhtml| and |uhtmlchange|
 * Fixed: Proper game cleanup when games end naturally
 * Fixed: Status and leaderboard now use proper UI management and clear on game end
 */

import type {Room, User, ChatCommands} from '../../../server/types';
import {
  SafariGame,
  DEFAULT_BALLS,
  DEFAULT_TIMEOUT,
  DEFAULT_TIMEBANK,
  DEFAULT_BLITZ_DURATION,
  Mode
} from './safari-game';

const safariGames = new Map<string, SafariGame>();

export const commands: ChatCommands = {
  safari: {
    // /safari create [balls],[timeout],[mode],[duration]
    create(target: string, room: Room, user: User) {
      // 1. Ensure we're in a room
      if (!room) return this.errorReply("Use this command in a room.");

      // 2. Prevent double-starts
      if (safariGames.has(room.id)) {
        return this.errorReply("A Safari Zone is already active.");
      }

      // 3. Parse arguments
      const [bStr, tStr, modeStr, dStr] = target.split(',').map(s => s.trim());
      const balls = parseInt(bStr) || DEFAULT_BALLS;
      const timeout = parseInt(tStr) ? parseInt(tStr) * 1000 : DEFAULT_TIMEOUT;
      const mode = (['normal', 'team', 'blitz'] as Mode[]).includes(modeStr as Mode)
        ? (modeStr as Mode)
        : 'normal';
      const duration =
        mode === 'blitz'
          ? (parseInt(dStr) ? parseInt(dStr) * 1000 : DEFAULT_BLITZ_DURATION)
          : 0;

      // 4. Validate values
      if (balls <= 0) return this.errorReply("Balls must be positive.");
      if (timeout < 5000) return this.errorReply("Timeout too short (minimum 5s).");
      if (mode === 'blitz' && duration < 10_000) {
        return this.errorReply("Blitz duration too short (minimum 10s).");
      }

      // 5. Create and store the game
      const game = new SafariGame(
        room,
        user,
        balls,
        timeout,
        DEFAULT_TIMEBANK,
        duration,
        mode,
      );
      
      // FIXED: Set up cleanup callback
      game.onGameEnd = () => {
        safariGames.delete(room.id);
        // Clear all UI elements when game ends
        room.add(`|uhtmlchange|safari-status-${room.id}|`);
        room.add(`|uhtmlchange|safari-leaderboard-${room.id}|`);
      };
      
      safariGames.set(room.id, game);

      // 6. Create the initial UI
      game.create();

      // 7. Announce creation
      room.add(
        `|raw|<div style="background: #3b82f6; color: white; padding: 10px; border-radius: 8px; text-align: center; margin: 5px 0;">` +
        `🌟 <strong>${user.name}</strong> created a Safari Zone! Join the adventure above! 🌟</div>`
      ).update();
    },

    join(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      game.join(user);
    },

    leave(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      game.leave(user);
    },

    spectate(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      game.spectate(user);
    },

    start(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      game.start(user);
    },

    catch(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      game.catch(user);
    },

    status(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) {
        // Clear status UI if no game exists
        room.add(`|uhtmlchange|safari-status-${room.id}|`).update();
        return this.errorReply("No active Safari Zone.");
      }
      
      const p = game.participants.get(user.id);
      if (!p) {
        // Clear status UI if user not in game
        room.add(`|uhtmlchange|safari-status-${room.id}|`).update();
        return this.errorReply("You're not playing.");
      }

      const statusHTML = 
        `<div style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); padding: 15px; border-radius: 10px; border: 2px solid #0284c7;">` +
        `<h4 style="margin: 0 0 10px 0; color: #0c4a6e;">🎯 ${user.name}'s Safari Status</h4>` +
        `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">` +
          `<div><strong>🎾 Poké Balls:</strong> ${p.balls}</div>` +
          `<div><strong>🏆 Score:</strong> ${p.score} BST</div>` +
          `<div><strong>⏱️ Time Bank:</strong> ${Math.ceil(p.timeBank / 1000)}s</div>` +
          `<div><strong>🎮 Mode:</strong> ${game.mode}</div>` +
        `</div>` +
        `${game.mode === 'team' && game.teamAssignments.has(user.id) ? 
          `<div style="margin-top: 10px; text-align: center; color: #1e40af;"><strong>Team: ${game.teamAssignments.get(user.id)}</strong></div>` : ''
        }` +
        `<div style="text-align: center; margin-top: 10px;">` +
          `<button name="send" value="/safari status" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">🔄 Refresh</button>` +
        `</div>` +
        `</div>`;

      // Use uhtml for first time, uhtmlchange for updates
      const existingStatus = room.log.some(entry => entry.includes(`safari-status-${room.id}`));
      if (existingStatus) {
        room.add(`|uhtmlchange|safari-status-${room.id}|${statusHTML}`).update();
      } else {
        room.add(`|uhtml|safari-status-${room.id}|${statusHTML}`).update();
      }
    },

    leaderboard(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) {
        // Clear leaderboard UI if no game exists
        room.add(`|uhtmlchange|safari-leaderboard-${room.id}|`).update();
        return this.errorReply("No active Safari Zone.");
      }

      const standings = [...game.participants.values()]
        .sort((a, b) => b.score - a.score)
        .map((p, i) => {
          const teamSuffix = game.mode === 'team' && game.teamAssignments.has(p.user.id)
            ? ` <span style="color: #6b7280;">[${game.teamAssignments.get(p.user.id)}]</span>`
            : '';
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          
          return `<tr style="${i < 3 ? 'background: #fef3c7;' : ''}">` +
              `<td style="text-align: center; font-size: 18px;">${medal}</td>` +
              `<td><strong>${p.user.name}</strong>${teamSuffix}</td>` +
              `<td style="text-align: center;">${p.balls}</td>` +
              `<td style="text-align: center; color: #dc2626; font-weight: bold;">${p.score}</td>` +
              `${game.mode !== 'blitz' ? `<td style="text-align: center;">${Math.ceil(p.timeBank / 1000)}s</td>` : ''}` +
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
              `${game.mode !== 'blitz' ? `<th style="padding: 10px; border: 1px solid #d97706;">Time Bank</th>` : ''}` +
            `</tr>` +
          `</thead>` +
          `<tbody>${standings}</tbody>` +
        `</table>` +
        `<div style="text-align: center; margin-top: 10px;">` +
          `<button name="send" value="/safari leaderboard" style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">🔄 Refresh</button>` +
        `</div>` +
        `</div>`;

      // Use uhtml for first time, uhtmlchange for updates
      const existingLeaderboard = room.log.some(entry => entry.includes(`safari-leaderboard-${room.id}`));
      if (existingLeaderboard) {
        room.add(`|uhtmlchange|safari-leaderboard-${room.id}|${leaderboardHTML}`).update();
      } else {
        room.add(`|uhtml|safari-leaderboard-${room.id}|${leaderboardHTML}`).update();
      }
    },

    end(target: string, room: Room, user: User) {
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      if (user.id !== game.host.id) {
        return this.errorReply("Only the host can end the game.");
      }
      
      // Clean up - the game.end() will call the cleanup callback
      game.end();
    },

    // Admin command to force-end stuck games
    forceend(target: string, room: Room, user: User) {
      this.checkCan('ban', null, room);
      if (!room) return this.errorReply("Use in a room.");
      const game = safariGames.get(room.id);
      if (!game) return this.errorReply("No active Safari Zone.");
      
      // FIXED: Let game.end() handle cleanup via callback
      game.end();
      room.add(`|raw|<div style="background: #dc2626; color: white; padding: 8px; border-radius: 5px; text-align: center;">⚠️ Game force-ended by ${user.name}</div>`).update();
    },

    // Check current games across all rooms (admin only)
    list(target: string, room: Room, user: User) {
      this.checkCan('lock');
      
      if (safariGames.size === 0) {
        return this.sendReply("No active Safari Zone games.");
      }

      const gamesList = [...safariGames.entries()]
        .map(([roomId, game]) => {
          const roomName = game.room.title || roomId;
          const playerCount = game.participants.size;
          const spectatorCount = game.spectators.size;
          const status = game.started ? 'Active' : 'Lobby';
          
          return `• <strong>${roomName}</strong> (${roomId}): ${status} | ${playerCount} players, ${spectatorCount} spectators | Host: ${game.host.name} | Mode: ${game.mode}`;
        })
        .join('<br />');

      this.sendReplyBox(
        `<div style="background: #f3f4f6; padding: 15px; border-radius: 8px; border: 1px solid #d1d5db;">` +
        `<h4 style="margin: 0 0 10px 0; color: #374151;">🎮 Active Safari Zone Games (${safariGames.size})</h4>` +
        `${gamesList}` +
        `</div>`
      );
    },

    help(target: string, room: Room, user: User) {
      this.sendReplyBox(
        `<div style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); padding: 20px; border-radius: 15px; border: 2px solid #0284c7;">` +
        `<h3 style="margin: 0 0 15px 0; color: #0c4a6e; text-align: center;">🌿 Safari Zone Commands</h3>` +
        
        `<div style="margin-bottom: 20px;">` +
          `<h4 style="color: #0369a1; margin: 0 0 8px 0;">🎯 Game Management</h4>` +
          `<div style="background: white; padding: 10px; border-radius: 8px; border-left: 4px solid #0284c7;">` +
            `<strong>/safari create [balls],[timeout],[mode],[duration]</strong><br />` +
            `<em>Create a new Safari Zone game</em><br />` +
            `<small>• balls: Poké Balls per player (default: ${DEFAULT_BALLS})<br />` +
            `• timeout: Turn timeout in seconds (default: ${DEFAULT_TIMEOUT / 1000})<br />` +
            `• mode: normal, team, or blitz (default: normal)<br />` +
            `• duration: Blitz mode duration in seconds (default: ${DEFAULT_BLITZ_DURATION / 1000})</small>` +
          `</div>` +
        `</div>` +

        `<div style="margin-bottom: 20px;">` +
          `<h4 style="color: #0369a1; margin: 0 0 8px 0;">👥 Player Actions</h4>` +
          `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">` +
            `<div style="background: white; padding: 8px; border-radius: 6px; border-left: 3px solid #10b981;">` +
              `<strong>/safari join</strong><br />` +
              `<small>Join the game</small>` +
            `</div>` +
            `<div style="background: white; padding: 8px; border-radius: 6px; border-left: 3px solid #f59e0b;">` +
              `<strong>/safari leave</strong><br />` +
              `<small>Leave before start</small>` +
            `</div>` +
            `<div style="background: white; padding: 8px; border-radius: 6px; border-left: 3px solid #6b7280;">` +
              `<strong>/safari spectate</strong><br />` +
              `<small>Watch without playing</small>` +
            `</div>` +
            `<div style="background: white; padding: 8px; border-radius: 6px; border-left: 3px solid #dc2626;">` +
              `<strong>/safari catch</strong><br />` +
              `<small>Catch on your turn</small>` +
            `</div>` +
          `</div>` +
        `</div>` +

        `<div style="margin-bottom: 20px;">` +
          `<h4 style="color: #0369a1; margin: 0 0 8px 0;">📊 Information</h4>` +
          `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">` +
            `<div style="background: white; padding: 6px; border-radius: 4px; text-align: center;">` +
              `<strong>/safari status</strong><br />` +
              `<small>Your stats</small>` +
            `</div>` +
            `<div style="background: white; padding: 6px; border-radius: 4px; text-align: center;">` +
              `<strong>/safari leaderboard</strong><br />` +
              `<small>Current rankings</small>` +
            `</div>` +
            `<div style="background: white; padding: 6px; border-radius: 4px; text-align: center;">` +
              `<strong>/safari help</strong><br />` +
              `<small>Show this help</small>` +
            `</div>` +
          `</div>` +
        `</div>` +

        `<div style="margin-bottom: 15px;">` +
          `<h4 style="color: #0369a1; margin: 0 0 8px 0;">🎮 Game Modes</h4>` +
          `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">` +
            `<div style="background: #f0f9ff; padding: 10px; border-radius: 6px; border: 1px solid #bae6fd;">` +
              `<strong>🎯 Normal</strong><br />` +
              `<small>Turn-based gameplay with time banks</small>` +
            `</div>` +
            `<div style="background: #fef7cd; padding: 10px; border-radius: 6px; border: 1px solid #fed7aa;">` +
              `<strong>👥 Team</strong><br />` +
              `<small>Players split into competing teams</small>` +
            `</div>` +
            `<div style="background: #fef2f2; padding: 10px; border-radius: 6px; border: 1px solid #fecaca;">` +
              `<strong>⚡ Blitz</strong><br />` +
              `<small>Fast-paced, catch anytime!</small>` +
            `</div>` +
          `</div>` +
        `</div>` +

        `<div style="background: #e0f2fe; padding: 10px; border-radius: 8px; border: 1px solid #0284c7;">` +
          `<h4 style="color: #0c4a6e; margin: 0 0 5px 0;">💡 How to Play</h4>` +
          `<small>Catch Pokémon to earn points based on their Base Stat Total (BST). Higher BST = more points! ` +
          `Manage your Poké Balls and time wisely. In team mode, work together for the highest combined score!</small>` +
        `</div>` +
        `</div>`
      );
    },
  },
};