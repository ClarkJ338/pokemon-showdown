/**
 * Random Region vs Region Teams (Single Region per Player) - Gen 9
 * Author: Musddik's custom format
 */

import {RandomTeams} from '../random-teams';

type RegionName = keyof typeof regionPools['ou'];

const regionPools = {
	ou: {
		Kanto: ['Pikachu', 'Charizard', 'Gengar', 'Snorlax', 'Dragonite', 'Alakazam'],
		Johto: ['Tyranitar', 'Suicune', 'Scizor', 'Ampharos', 'Heracross', 'Blissey'],
		Hoenn: ['Metagross', 'Salamence', 'Gardevoir', 'Swampert', 'Milotic', 'Flygon'],
		Sinnoh: ['Garchomp', 'Lucario', 'Togekiss', 'Infernape', 'Roserade', 'Gliscor'],
		Unova: ['Hydreigon', 'Excadrill', 'Chandelure', 'Conkeldurr', 'Volcarona', 'Ferrothorn'],
		Kalos: ['Greninja', 'Talonflame', 'Aegislash', 'Goodra', 'Noivern', 'Sylveon'],
		Alola: ['Toucannon', 'Incineroar', 'Primarina', 'Kommo-o', 'Tsareena', 'Mudsdale'],
		Galar: ['Dragapult', 'Corviknight', 'Cinderace', 'Toxtricity', 'Grimmsnarl', 'Duraludon'],
		Paldea: ['Skeledirge', 'Pawmot', 'Annihilape', 'Baxcalibur', 'Garganacl', 'Iron Valiant'],
	},
	uu: {
		Kanto: ['Arcanine', 'Machamp', 'Lapras', 'Rhydon', 'Victreebel', 'Clefable'],
		Johto: ['Crobat', 'Kingdra', 'Miltank', 'Houndoom', 'Espeon', 'Umbreon'],
		Hoenn: ['Ludicolo', 'Aggron', 'Manectric', 'Claydol', 'Walrein', 'Hariyama'],
		Sinnoh: ['Electivire', 'Magmortar', 'Mamoswine', 'Bronzong', 'Spiritomb', 'Yanmega'],
		Unova: ['Galvantula', 'Cofagrigus', 'Mienshao', 'Krookodile', 'Reuniclus', 'Jellicent'],
		Kalos: ['Barbaracle', 'Malamar', 'Heliolisk', 'Trevenant', 'Gourgeist', 'Dragalge'],
		Alola: ['Ribombee', 'Bewear', 'Palossand', 'Togedemaru', 'Drampa', 'Oricorio'],
		Galar: ['Coalossal', 'Centiskorch', 'Indeedee', 'Frosmoth', 'Runerigus', 'Perrserker'],
		Paldea: ['Kilowattrel', 'Bombirdier', 'Revavroom', 'Glimmora', 'Farigiraf', 'Maushold'],
	},
	ru: {
		Kanto: ['Fearow', 'Dugtrio', 'Persian', 'Hitmonlee', 'Electrode', 'Tangela'],
		Johto: ['Ariados', 'Lanturn', 'Quagsire', 'Granbull', 'Shuckle', 'Magcargo'],
		Hoenn: ['Swellow', 'Cacturne', 'Whiscash', 'Torkoal', 'Banette', 'Glalie'],
		Sinnoh: ['Purugly', 'Lopunny', 'Carnivine', 'Chatot', 'Bastiodon', 'Wormadam'],
		Unova: ['Stoutland', 'Swoobat', 'Leavanny', 'Maractus', 'Alomomola', 'Beheeyem'],
		Kalos: ['Furfrou', 'Meowstic', 'Pangoro', 'Aurorus', 'Carbink', 'Slurpuff'],
		Alola: ['Gumshoos', 'Crabominable', 'Lurantis', 'Shiinotic', 'Bruxish', 'Komala'],
		Galar: ['Greedent', 'Thievul', 'Dubwool', 'Boltund', 'Cramorant', 'Eiscue'],
		Paldea: ['Squawkabilly', 'Oinkologne', 'Spidops', 'Bellibolt', 'Dachsbun', 'Grafaiai'],
	},
};

export class RandomRegionTierTeams extends RandomTeams {
	getRegionPoolForTier(tier: 'ou' | 'uu' | 'ru') {
		return regionPools[tier];
	}

	randomTeam(): PokemonSet[] {
		// Determine tier from format ID
		const tier = (this.format.id.includes('uu') ? 'uu' :
			this.format.id.includes('ru') ? 'ru' : 'ou') as 'ou' | 'uu' | 'ru';

		const pool = this.getRegionPoolForTier(tier);

		// Ensure battle storage for region assignments
		if (!this.battle.regionAssignments) {
			this.battle.regionAssignments = {};
		}

		let myRegion: RegionName;

		if (!this.battle.regionAssignments.p1) {
			// First team (Player 1)
			myRegion = this.sample(Object.keys(pool)) as RegionName;
			this.battle.regionAssignments.p1 = myRegion;
		} else if (!this.battle.regionAssignments.p2) {
			// Second team (Player 2) — pick from remaining regions
			const remainingRegions = Object.keys(pool).filter(r => r !== this.battle.regionAssignments.p1);
			myRegion = this.sample(remainingRegions) as RegionName;
			this.battle.regionAssignments.p2 = myRegion;
		} else {
			// Fallback (shouldn't happen)
			myRegion = this.sample(Object.keys(pool)) as RegionName;
		}

		// Pick 6 Pokémon from that region
		const chosenMons = this.sampleMany(pool[myRegion], 6);

		// Build the team
		const team: PokemonSet[] = [];
		for (const name of chosenMons) {
			team.push(this.randomSet(name));
		}

		// Define colors for each region
		const regionColors: {[key in RegionName]: string} = {
			Kanto: '#FF0000',
			Johto: '#996600',
			Hoenn: '#009900',
			Sinnoh: '#3366FF',
			Unova: '#6600CC',
			Kalos: '#FF66CC',
			Alola: '#FF9900',
			Galar: '#00CCCC',
			Paldea: '#999999',
		};

		// Announce the matchup once both regions are set
		if (this.battle.regionAssignments.p1 && this.battle.regionAssignments.p2 && !this.battle.regionAnnounced) {
			const r1 = this.battle.regionAssignments.p1;
			const r2 = this.battle.regionAssignments.p2;
			const tierName = tier.toUpperCase();

			// Get player names
			const p1Name = this.battle.p1.name;
			const p2Name = this.battle.p2.name;

			this.battle.add(
				'message',
				`🌍 <b><span style="color:${regionColors[r1]}">${p1Name} (${r1})</span></b> vs <b><span style="color:${regionColors[r2]}">${p2Name} (${r2})</span></b> — ${tierName} Showdown!`
			);
			this.battle.regionAnnounced = true;
		}

		return team;
	}
					}
