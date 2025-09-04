/**
 * Dungeon Plugin
 * Single-player dungeon exploration with auto-generated battles
 */

import { Utils } from '../lib';

interface DungeonRun {
  user: User;
  depth: number;
  team: string;        // packed team
  items: string[];
  battleRoom?: Room;
  pendingTM?: string | null;
}

class DungeonManagerClass {
  runs = new Map<ID, DungeonRun>();

  start(user: User) {
    if (this.runs.has(user.id)) return `You already have a dungeon run active!`;

    // Starter: Charmander
    const starterSet: PokemonSet = {
      species: "Charmander",
      ability: "Blaze",
      moves: ["scratch"],
      nature: "Serious",
      evs: {hp: 0},
      ivs: {atk: 31},
      level: 5,
    };
    const team = Teams.pack([starterSet]);

    this.runs.set(user.id, {
      user,
      depth: 1,
      team,
      items: [],
      battleRoom: undefined,
      pendingTM: null,
    });

    return `${user.name} enters the dungeon with Charmander at level 5! Use /dungeon explore to begin.`;
  }

  end(user: User) {
    if (!this.runs.has(user.id)) return `You don’t have an active dungeon run.`;
    this.runs.delete(user.id);
    return `${user.name} has ended their dungeon run.`;
  }

  status(user: User) {
    const run = this.runs.get(user.id);
    if (!run) return `You don’t have an active dungeon run.`;
    return `Depth: ${run.depth}, Items: ${run.items.join(", ") || "none"}`;
  }

  explore(user: User) {
    const run = this.runs.get(user.id);
    if (!run) return `You don’t have an active dungeon run.`;

    if (run.depth % 5 === 0) {
      // Boss battle
      run.battleRoom = Rooms.createBattle({
        format: "[Gen 9] Dungeon Battle",
        rated: false,
        players: [
          {name: user.name, team: run.team, id: user.id},
          {name: "Dungeon Bot", team: this.getBossTeam(run.depth), id: "impulserouge"},
        ],
      });
      if (run.battleRoom) {
        run.battleRoom.add(`⚔️ ${user.name} faces a Dungeon Boss at depth ${run.depth}!`).update();
      }
      return `A boss appears! Battle started in ${run.battleRoom?.roomid}`;
    } else {
      // Wild battle
      run.battleRoom = Rooms.createBattle({
        format: "[Gen 9] Dungeon Battle",
        rated: false,
        players: [
          {name: user.name, team: run.team, id: user.id},
          {name: "Dungeon Bot", team: this.getWildTeam(run.depth), id: "impulserouge"},
        ],
      });
      if (run.battleRoom) {
        run.battleRoom.add(`🌑 ${user.name} explores depth ${run.depth}... a wild Pokémon attacks!`).update();
      }
      return `A wild Pokémon appears! Battle started in ${run.battleRoom?.roomid}`;
    }
  }

  // 🔹 Wild encounters scale by depth
  getWildTeam(depth: number): string {
    const wilds = ["Zubat", "Rattata", "Geodude", "Oddish", "Poliwag"];
    const mon = Dex.species.get(Utils.randomElement(wilds));

    const wildSet: PokemonSet = {
      species: mon.name,
      ability: mon.abilities ? Object.values(mon.abilities)[0] : "Run Away",
      moves: (mon.randomBattleMoves || ["tackle"]).slice(0, 2),
      nature: "Serious",
      evs: {hp: 0},
      ivs: {atk: 31},
      level: Math.min(100, 3 + depth * 2),
    };

    return Teams.pack([wildSet]);
  }

  // 🔹 Boss fights
  getBossTeam(depth: number): string {
    const bosses = ["Onix", "Gengar", "Dragonite"];
    const mon = Dex.species.get(Utils.randomElement(bosses));

    const bossSet: PokemonSet = {
      species: mon.name,
      ability: mon.abilities ? Object.values(mon.abilities)[0] : "Pressure",
      moves: (mon.randomBattleMoves || ["tackle"]).slice(0, 4),
      nature: "Serious",
      evs: {hp: 0},
      ivs: {atk: 31},
      level: Math.min(100, 10 + depth * 3),
    };

    return Teams.pack([bossSet]);
  }

  checkEvolution(run: DungeonRun) {
    const teamSet = Teams.unpack(run.team);
    if (!teamSet || !teamSet[0]) return null;
    const mon = teamSet[0];

    if (mon.species === "Charmander" && run.depth >= 3) {
      mon.species = "Charmeleon";
      run.team = Teams.pack([mon]);
      return `${run.user.name}'s Charmander evolved into Charmeleon! 🔥`;
    }
    if (mon.species === "Charmeleon" && run.depth >= 7) {
      mon.species = "Charizard";
      run.team = Teams.pack([mon]);
      return `${run.user.name}'s Charmeleon evolved into Charizard! 🔥🔥`;
    }
    return null;
  }

  teachTM(user: User, moveName: string) {
    const run = this.runs.get(user.id);
    if (!run) return `You don’t have an active dungeon run.`;

    const move = Dex.moves.get(moveName);
    if (!move.exists) return `Invalid move: ${moveName}`;
    const tm = `TM:${move.name}`;
    if (!run.items.includes(tm)) return `You don’t own ${tm}.`;

    const teamSet = Teams.unpack(run.team);
    if (!teamSet || !teamSet[0]) return `Error loading team.`;

    if (teamSet[0].moves.includes(move.id)) {
      return `${run.user.name}'s Pokémon already knows ${move.name}!`;
    }

    if (teamSet[0].moves.length >= 4) {
      run.pendingTM = move.id;
      return `Your Pokémon already knows 4 moves! Use /dungeon forget [1-4] to replace a move with ${move.name}.`;
    }

    teamSet[0].moves.push(move.id);
    run.team = Teams.pack(teamSet);
    run.items = run.items.filter(i => i !== tm);

    return `${run.user.name}'s Pokémon learned ${move.name} from ${tm}!`;
  }

  forgetMove(user: User, slot: string) {
    const run = this.runs.get(user.id);
    if (!run) return `You don’t have an active dungeon run.`;
    if (!run.pendingTM) return `You don’t have a pending TM to learn.`;

    const teamSet = Teams.unpack(run.team);
    if (!teamSet || !teamSet[0]) return `Error loading team.`;
    const index = parseInt(slot) - 1;
    if (isNaN(index) || index < 0 || index >= teamSet[0].moves.length) {
      return `Invalid slot. Choose 1–${teamSet[0].moves.length}.`;
    }

    const oldMove = Dex.moves.get(teamSet[0].moves[index]).name;
    const newMove = Dex.moves.get(run.pendingTM).name;

    teamSet[0].moves[index] = run.pendingTM;
    run.team = Teams.pack(teamSet);
    run.pendingTM = null;

    return `${run.user.name}'s Pokémon forgot ${oldMove} and learned ${newMove}!`;
  }
}

export const DungeonManager = new DungeonManagerClass();

export const commands: ChatCommands = {
  dungeon(target, room, user) {
    const [sub, arg] = target.split(' ');
    switch (sub) {
      case 'start':
        return this.sendReply(DungeonManager.start(user));
      case 'explore':
        return this.sendReply(DungeonManager.explore(user));
      case 'status':
        return this.sendReply(DungeonManager.status(user));
      case 'end':
        return this.sendReply(DungeonManager.end(user));
      case 'tm':
        return this.sendReply(DungeonManager.teachTM(user, arg));
      case 'forget':
        return this.sendReply(DungeonManager.forgetMove(user, arg));
      default:
        return this.sendReply(`Usage: /dungeon start | explore | status | end | tm [move] | forget [slot]`);
    }
  },
};

export const handlers: Chat.Handlers = {
  onBattleEnd(room, winner) {
    if (room.battle?.format !== '[Gen 9] Dungeon Battle') return;

    for (const [userid, run] of DungeonManager.runs) {
      if (run.battleRoom?.roomid === room.roomid) {
        if (winner === userid) {
          run.depth++;
          const evoMessage = DungeonManager.checkEvolution(run);
          if (evoMessage) room.add(evoMessage).update();

          if (run.depth % 5 === 1) {
            run.items.push("Rare Candy");
            room.add(`${run.user.name} defeated the BOSS! Reward: Rare Candy 🎁`).update();
          } else {
            room.add(`${run.user.name} moves deeper to depth ${run.depth}!`).update();
          }
        } else {
          DungeonManager.runs.delete(userid);
          room.add(`${run.user.name} was defeated... Dungeon run over.`).update();
        }
      }
    }
  },
};
              
