/* server/chat-plugins/safari.ts
 *
 * Advanced Safari Zone:
 * - Turn-based with per-player time bank and timeout warnings
 * - Automated catch on timeout (low-BST common Pokémon)
 * - Wild encounters weighted by rarity tiers
 * - Spectator mode
 * - Optional team or blitz modes
 */
/*
import {Dex} from '../../../sim/dex';
import type {Room, User, ChatCommands} from '../../../server/types';

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

const safariGames = new Map<string, SafariGame>();

class SafariGame {
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

  // Add a player
  join(user: User) {
    if (this.started && this.mode !== 'blitz') {
      return user.sendTo(this.room.id, `|error|Game already started.`);
    }
    const uid = user.id;
    if (this.participants.has(uid)) {
      return user.sendTo(this.room.id, `|error|You’re already in.`);
    }
    this.participants.set(uid, {
      user, balls: this.ballsPerPlayer,
      score: 0, timeBank: this.timeBankDefault,
    });
    this.room.add(`|raw|<b>${user.name}</b> joined Safari Zone.`);
    user.send(`|pm|&Safari Zone|${user.name}|You have ${this.ballsPerPlayer} balls and ${this.timeBankDefault/1000}s time bank.`);
    this.room.update();
  }

  // Remove before start
  leave(user: User) {
    if (this.started && this.mode !== 'blitz') {
      return user.sendTo(this.room.id, `|error|Cannot leave after start.`);
    }
    if (!this.participants.delete(user.id)) {
      return user.sendTo(this.room.id, `|error|You’re not in the lobby.`);
    }
    this.room.add(`|raw|<b>${user.name}</b> left Safari Zone.`);
    this.room.update();
  }

  // Allow spectators
  spectate(user: User) {
    if (this.participants.has(user.id)) {
      return user.sendTo(this.room.id, `|error|Players cannot spectate.`);
    }
    this.spectators.add(user.id);
    user.send(`|pm|&Safari Zone|${user.name}|You’re now spectating. Enjoy!`);
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

  // Build a single string of HTML for all teams
  const teamsText = ids
    .map(uid => {
      const username = this.participants.get(uid)!.user.name;
      const teamName = this.teamAssignments.get(uid);
      // Return a quoted string of HTML, not JSX
      return `<b>${username}</b> (${teamName})`;
    })
    .join(', ');

  // Now splice it into your raw HTML template
  this.room.add(
    `|raw|<b>Teams assigned:</b> ${teamsText}`
  ).update();
	 }

    this.room.add(`|raw|<b>Safari Zone Begins!</b> Mode: ${this.mode} — ${this.ballsPerPlayer} balls each. ${
  this.mode !== 'blitz'
    ? `Time bank: ${this.timeBankDefault / 1000}s; turn timeout: ${this.turnTimeout / 1000}s.`
    : `Blitz duration: ${this.blitzDuration / 1000}s.`
}`).update();
    // Blitz global timer
    if (this.mode === 'blitz') {
      this.timer = setTimeout(() => this.end(), this.blitzDuration);
      return;
    }

    // Initialize turn order
    this.turnOrder = [...this.participants.keys()];
    this.turnIndex = 0;
    this.nextTurn();
  }

  // Process a catch action
  catch(user: User) {
    if (!this.started) {
      return user.sendTo(this.room.id, `|error|Game hasn’t started.`);
    }
    const uid = user.id;

    // Blitz mode: any time
    if (this.mode === 'blitz') {
      return this.processCatch(uid, this.autoEncounter());
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

  // 4) Build the full raw HTML message in one go
  const catchMessage = `|raw|<b>${entry.user.name}${teamSuffix}</b> caught ${species.name} ` +
    `(BST ${bst}). ${entry.balls} balls left.`;

  // 5) Post it to the room
  this.room.add(catchMessage);
  this.room.update();

  // 6) Notify any spectators privately
  for (const sid of this.spectators) {
    const spectator = this.room.server.getUser(sid);
    if (spectator) {
      spectator.send(
        `|pm|&Safari Spectate|${spectator.name}|` +
        `${entry.user.name} caught ${species.name}.`
      );
    }
  }

  // 7) Log for staff audits
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
    this.room.add(`|raw|<b>${entry.user.name}</b> timed out and auto-caught.`).update();
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
    this.room.add(
      `|raw|<b>It’s ${entry.user.name}’s turn!</b> +` +
       `(${entry.timeBank/1000}s left, ${entry.balls} balls). +` +
       `Use <code>/safari catch</code>.`
    ).update();

    // Warning 10s before per-turn timeout
    const warnTime = Math.max(0, this.turnTimeout - 10_000);
    this.warningTimer = setTimeout(() => {
      entry.user.send(`|pm|&Safari Zone|${entry.user.name}|10s left to act!`);
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
          ? `[${this.teamAssignments.get(p.user.id)}]`
          : '';
        return `${i + 1}. ${p.user.name}${teamSuffix}: ${p.score}`;
      });

    this.room
      .add(`|raw|<b>Game Over!</b><br />${standings.join('<br />')}`)
      .update();
  } else {
    this.room
      .add(`|raw|<b>Safari Zone cancelled.</b>`)
      .update();
  }
  safariGames.delete(this.room.id);
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

export const commands: ChatCommands = {
  safari: {
    // /safari create [balls],[timeout],[mode],[duration]
	  create(target: string, room: Room, user: User) {
  // 1. Ensure we’re in a room
  if (!room) return this.errorReply("Use this command in a room.");

  // 2. Prevent double‐starts
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
  if (timeout < 5000) return this.errorReply("Timeout too short.");
  if (mode === 'blitz' && duration < 10_000) {
    return this.errorReply("Blitz duration too short.");
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
  safariGames.set(room.id, game);

  // 6. Announce with a single, balanced template literal
  room
    .add(
      `|raw|<b>${user.name}</b> created Safari Zone: ${balls} balls, mode=${mode}. ${
        mode !== 'blitz'
          ? `Turn timeout: ${timeout / 1000}s; time bank: ${DEFAULT_TIMEBANK / 1000}s.`
          : `Blitz duration: ${duration / 1000}s.`
      } <button name="send" value="/safari join">Join Safari</button>`
    )
    .update();
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
  if (!game) return this.errorReply("No active Safari Zone.");
  const p = game.participants.get(user.id);
  if (!p) return this.errorReply("You're not playing.");

  user.sendTo(
    room.id,
    `|pm|&Safari Status|${user.name}|` +
    `Balls: ${p.balls}, Score: ${p.score}, ` +
    `Time left: ${Math.ceil(p.timeBank / 1000)}s`
  );
},

leaderboard(target: string, room: Room, user: User) {
  if (!room) return this.errorReply("Use in a room.");
  const game = safariGames.get(room.id);
  if (!game) return this.errorReply("No active Safari Zone.");

  const standings = [...game.participants.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => `${i + 1}. ${p.user.name}: ${p.score}`);

  user.sendTo(
    room.id,
    `|pm|&Safari Leaderboard|${user.name}|${standings.join("<br />")}`
  );
},

end(target: string, room: Room, user: User) {
  if (!room) return this.errorReply("Use in a room.");
  const game = safariGames.get(room.id);
  if (!game) return this.errorReply("No active Safari Zone.");
  if (user.id !== game.host.id) {
    return this.errorReply("Only the host can end the game.");
  }
  game.end();
},

	  help(target: string, room: Room, user: User) {
  this.sendReplyBox(
    `<b>Safari Zone Commands</b><br />` +
    ` • <code>/safari create [balls],[timeout],[mode],[duration]</code> – Create a game:<br />` +
      `&nbsp;&nbsp;• balls: number of Poké Balls (default ${DEFAULT_BALLS})<br />` +
      `&nbsp;&nbsp;• timeout: per-turn timeout in seconds (default ${DEFAULT_TIMEOUT / 1000})<br />` +
      `&nbsp;&nbsp;• mode: normal (default), team, or blitz<br />` +
      `&nbsp;&nbsp;• duration: blitz duration in seconds (default ${DEFAULT_BLITZ_DURATION / 1000})<br />` +
    `• <code>/safari join</code> – Join the game<br />` +
    `• <code>/safari leave</code> – Leave before start<br />` +
    `• <code>/safari spectate</code> – Watch without playing<br />` +
    `• <code>/safari start</code> – Host starts the game<br />` +
    `• <code>/safari catch</code> – Catch on your turn (or anytime in blitz)<br />` +
    `• <code>/safari status</code> – View your stats<br />` +
    `• <code>/safari leaderboard</code> – Show final standings (or auto on end)<br />` +
    `• <code>/safari end</code> – Host cancels/ends the game<br />`
  );
},
  },
};
