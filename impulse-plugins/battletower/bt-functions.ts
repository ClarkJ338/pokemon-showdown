import * as fs from 'fs';
import * as path from 'path';

// Define the data structures for streaks and active teams.
export const winStreaks = new Map<string, number>();
export const maxWinStreaks = new Map<string, number>();
export const currentTeams = new Map<string, Pokemon[]>(); // Changed to store the actual Pokemon array
export const BOTID = 'impulserouge';

// Define the file path for persistent data.
const DATA_DIR = 'impulse-plugins/battletower/data';
const DATA_FILE = path.join(DATA_DIR, 'battletower.json');
const RENTAL_TEAMS_FILE = path.join(DATA_DIR, 'rentalteams.json');
const BOT_TEAMS_FILE = path.join(DATA_DIR, 'botteams.json');

// Define a type for the team data from JSON
export interface Pokemon {
		species: string;
		ability: string;
		item?: string;
		moves: string[];
		evs: { [stat: string]: number };
		ivs?: { [stat: string]: number };
		nature?: string;
		teraType?: string;
		gender?: string;
		shiny?: boolean;
}

export interface RentalTeam {
		id: string;
		name: string;
		pokemons: Pokemon[];
}

export let rentalTeams: Map<string, RentalTeam> = new Map();
export let botTeams: Map<string, RentalTeam> = new Map();
export let allRentalPokemon: Pokemon[] = []; // New array for player's Pokemon pool
export let allBotPokemon: Pokemon[] = []; // New array for bot's Pokemon pool

// Track human players in active Battle Tower matches to prevent starting multiple at once.
export const activeBattles = new Set();

// A function to ensure the directory exists before saving.
function ensureDirExists(dirPath: string) {
		if (!fs.existsSync(dirPath)) {
				fs.mkdirSync(dirPath, { recursive: true });
		}
}

// A function to save the data to the file.
export function saveData() {
		ensureDirExists(DATA_DIR);
		const data = {
				winStreaks: [...winStreaks.entries()],
				maxWinStreaks: [...maxWinStreaks.entries()],
				// Don't save currentTeams as they are temporary and generated per run
		};
		fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// A function to load the data from the file.
function loadData() {
		if (!fs.existsSync(DATA_FILE)) {
				return;
		}
		try {
				const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
				if (data.winStreaks) {
						data.winStreaks.forEach(([key, value]: [string, number]) => winStreaks.set(key, value));
				}
				if (data.maxWinStreaks) {
						data.maxWinStreaks.forEach(([key, value]: [string, number]) => maxWinStreaks.set(key, value));
				}
		} catch (e) {
				console.error("Failed to load Battle Tower data:", e);
		}
}

// A function to load the teams from the JSON file and populate the dynamic pools.
function loadTeams() {
		// Load rental teams for players
		if (!fs.existsSync(RENTAL_TEAMS_FILE)) {
				console.error("rentalteams.json not found!");
		} else {
				try {
						const teamData: RentalTeam[] = JSON.parse(fs.readFileSync(RENTAL_TEAMS_FILE, 'utf8'));
						rentalTeams.clear();
						allRentalPokemon = [];
						for (const team of teamData) {
								rentalTeams.set(toID(team.id), team);
								allRentalPokemon.push(...team.pokemons);
						}
				} catch (e) {
						console.error("Failed to load rental teams:", e);
				}
		}

		// Load bot teams
		if (!fs.existsSync(BOT_TEAMS_FILE)) {
				console.error("botteams.json not found!");
		} else {
				try {
						const teamData: RentalTeam[] = JSON.parse(fs.readFileSync(BOT_TEAMS_FILE, 'utf8'));
						botTeams.clear();
						allBotPokemon = [];
						for (const team of teamData) {
								botTeams.set(toID(team.id), team);
								allBotPokemon.push(...team.pokemons);
						}
				} catch (e) {
						console.error("Failed to load bot teams:", e);
				}
		}
}

// A new function to generate a random team of a specific size from a pool.
export function generateRandomTeam(size: number, pokemonPool: Pokemon[]): Pokemon[] | null {
		if (pokemonPool.length === 0) {
				return null;
		}
		const team: Pokemon[] = [];
		const poolIndices = Array.from({ length: pokemonPool.length }, (_, i) => i);
		
		// Shuffle the indices to pick a random subset
		for (let i = poolIndices.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[poolIndices[i], poolIndices[j]] = [poolIndices[j], poolIndices[i]];
		}

		const numToPick = Math.min(size, pokemonPool.length);
		for (let i = 0; i < numToPick; i++) {
				const randomIndex = poolIndices.pop();
				if (randomIndex !== undefined) {
						team.push(pokemonPool[randomIndex]);
				}
		}
		return team;
}

// A new function to add a random Pokemon to an existing team.
export function addRandomPokemonToTeam(currentTeam: Pokemon[], pokemonPool: Pokemon[]): Pokemon[] | null {
		const existingSpecies = new Set(currentTeam.map(p => p.species));
		const availablePokemon = pokemonPool.filter(p => !existingSpecies.has(p.species));

		if (availablePokemon.length === 0) {
				return null;
		}

		const randomIndex = Math.floor(Math.random() * availablePokemon.length);
		const newPokemon = availablePokemon[randomIndex];
		currentTeam.push(newPokemon);
		return currentTeam;
}

// A function to get a specific opponent team based on streak.
export function getOpponentTeam(streak: number): Pokemon[] | null {
		// The team size starts at 1 and increases by 1 for every 5 wins, up to a max of 6.
		const teamSize = Math.min(6, Math.floor(streak / 5) + 1);
		return generateRandomTeam(teamSize, allBotPokemon);
}

// Initialize data and teams
export function initializeBattleTower() {
		loadData();
		loadTeams();
}

// Call initialization
initializeBattleTower();
