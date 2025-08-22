/**
 * Random Region vs Region Teams (OU, UU, RU) - Gen 9
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

	randomRegion(): RegionName {
		const tier = (this.format.id.includes('uu') ? 'uu' :
			this.format.id.includes('ru') ? 'ru' : 'ou') as 'ou' | 'uu' | 'ru';
		const pool = this.getRegionPoolForTier(tier);
		return this.sample(Object.keys(pool)) as RegionName;
	}

	randomTeam(): PokemonSet[] {
		// Pick two distinct regions
		const region1 = this.randomRegion();
		let region2 = this.randomRegion();
		while (region2 === region1) {
			region2 = this.randomRegion();
		}

		const tier = (this.format.id.includes('uu') ? 'uu' :
			this.format.id.includes('ru') ? 'ru' : 'ou') as 'ou' | 'uu' | 'ru';
		const pool = this.getRegionPoolForTier(tier);

		// Merge both region pools
		const combinedPool = [...pool[region1], ...pool[region2]];

		// Pick 6 Pokémon from the combined pool
		const team: PokemonSet[] = [];
		const chosenMons = this.sampleMany(combinedPool, 6);

		for (const name of chosenMons) {
			team.push(this.randomSet(name));
		}

		return team;
	}
		}
