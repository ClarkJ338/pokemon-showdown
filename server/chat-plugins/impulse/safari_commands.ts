/* server/chat-plugins/impulse/safari-game.ts */

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
        // Clear main UI when game ends
        room.add(`|uhtmlchange|safari-${room.id}|`);
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
			  return this.errorReply("No active Safari Zone.");
		  }
		  if (!game.showStatus(user)) {
			  return this.errorReply("You're not playing.");
		  }
	  },
	  
	  leaderboard(target: string, room: Room, user: User) {
		  if (!room) return this.errorReply("Use in a room.");
		  const game = safariGames.get(room.id);
		  if (!game) {
			  return this.errorReply("No active Safari Zone.");
		  }
		  // Pass the user object so it only shows to them
		  game.showLeaderboard(user);
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
		  if (!this.canBroadcast()) return;
		  this.sendReplyBox(
    '' +
    '<div class="infobox-limited" style="text-align: center;">' +
      '<h3>🌿 Safari Zone Commands</h3>' +

      '<h4>Game Management</h4>' +
      '<ul>' +
        '<li>' +
          '<strong>/safari create [balls],[timeout],[mode],[duration]</strong><br />' +
          'Create a new Safari Zone game.<br />' +
          '• balls: Poké Balls per player (default: ' + DEFAULT_BALLS + ')<br />' +
          '• timeout: Turn timeout in seconds (default: ' + (DEFAULT_TIMEOUT / 1000) + ')<br />' +
          '• mode: normal, team, or blitz (default: normal)<br />' +
          '• duration: Blitz mode duration in seconds (default: ' + (DEFAULT_BLITZ_DURATION / 1000) + ')' +
        '</li>' +
      '</ul>' +

      '<h4>Player Actions</h4>' +
      '<ul>' +
        '<li><strong>/safari join</strong>: Join the game</li>' +
        '<li><strong>/safari leave</strong>: Leave before start</li>' +
        '<li><strong>/safari spectate</strong>: Watch without playing</li>' +
        '<li><strong>/safari catch</strong>: Catch on your turn</li>' +
      '</ul>' +

      '<h4>Information</h4>' +
      '<ul>' +
        '<li><strong>/safari status</strong>: Your stats</li>' +
        '<li><strong>/safari leaderboard</strong>: Current rankings</li>' +
        '<li><strong>/safari help</strong>: Show this help</li>' +
      '</ul>' +

      '<h4>Game Modes</h4>' +
      '<ul>' +
        '<li><strong>Normal</strong>: Turn-based gameplay with time banks</li>' +
        '<li><strong>Team</strong>: Players split into competing teams</li>' +
        '<li><strong>Blitz</strong>: Fast-paced, catch anytime!</li>' +
      '</ul>' +

      '<p>' +
        '<strong>How to Play:</strong><br />' +
        'Catch Pokémon to earn points based on their Base Stat Total (BST). Higher BST = more points! ' +
        'Manage your Poké Balls and time wisely. In team mode, work together for the highest combined score.' +
      '</p>' +
    '</div>'
  );
	  }
  },
};
