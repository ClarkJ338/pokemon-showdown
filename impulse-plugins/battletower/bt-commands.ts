import {
		winStreaks,
		maxWinStreaks,
		currentTeams,
		activeBattles,
		rentalTeams,
		allRentalPokemon,
		allBotPokemon,
		BOTID,
		Pokemon,
		RentalTeam,
		generateRandomTeam,
		addRandomPokemonToTeam,
		getOpponentTeam,
		saveData
} from './bt-functions';

export const commands: Chat.ChatCommands = {
		bt: {
				''(target, room, user) {
						this.parse(`/bt help`);
				},

				start(target, room, user) {
						if (!this.canTalk()) return false;
						
						// The `target` parameter is no longer used for team selection.
						if (target) {
								return this.errorReply(`The /bt start command no longer accepts a team ID. Use /bt teamlist to see available Pokémon pools.`);
						}

						if (activeBattles.has(user.id)) {
								return this.errorReply(`You are already in a Battle Tower battle.`);
						}

						const currentStreak = winStreaks.get(user.id) || 0;
						let playerTeam = currentTeams.get(user.id);
						
						// Generate a new team if the user has no active one, or if their streak has reset.
						if (!playerTeam || currentStreak === 0) {
								playerTeam = generateRandomTeam(1, allRentalPokemon);

								if (!playerTeam) {
										return this.errorReply(`Failed to generate a team. The rental Pokémon pool might be empty.`);
								}
								currentTeams.set(user.id, playerTeam);
						} else {
								// Check if we need to add a new Pokemon to the team
								const currentTeamSize = playerTeam.length;
								const newTeamSize = Math.min(6, Math.floor(currentStreak / 5) + 1);

								if (newTeamSize > currentTeamSize) {
										const newTeam = addRandomPokemonToTeam(playerTeam, allRentalPokemon);
										if (!newTeam) {
												return this.errorReply(`Failed to add a new Pokémon to your team. Please contact a staff member.`);
										}
										playerTeam = newTeam;
										currentTeams.set(user.id, playerTeam);
								}
						}

						const player1 = user;
						const player2 = Users.get(`${BOTID}`);
								
						if (!player2 || !player2.connected) {
								return this.errorReply(`The bot ${BOTID} is currently offline.`);
						}
								
						const opponentTeamObjects = getOpponentTeam(currentStreak);

						if (!opponentTeamObjects) {
								return this.errorReply(`Failed to find an opponent team. Please contact a staff member.`);
						}

						this.sendReply(`Starting a Battle Tower match with a team of ${playerTeam.length} Pokémon...`);

						const options = {
								players: [{ user: player1, team: playerTeam }, { user: player2, team: opponentTeamObjects }],
								format: 'gen9battletower',
								title: `Battle Tower: ${player1.name} vs. ${player2.name}`,
								rated: 0,
						};

						const battleRoom = Rooms.createBattle(options);
						if (!battleRoom) {
								return this.errorReply(`Failed to create the battle room.`);
						}
								
						activeBattles.add(user.id);
						return true;
				},

				viewteam(target, room, user) {
						if (!target) {
								// No target, show the user's current team.
								const currentTeam = currentTeams.get(user.id);
								if (!currentTeam) {
										return this.errorReply(`You do not have an active Battle Tower team. Use '/bt start' to begin a run.`);
								}

								let output = `<b>Your Current Battle Tower Team</b><br><br>`;
								currentTeam.forEach(p => {
										output += `<div style="max-height: 300px; overflow: auto;">`;
										output += `<h3>${p.species} <small>(${p.gender || ''})</small></h3>`;
										output += `<div><b>Item:</b> ${p.item || 'No Item'}</div>`;
										output += `<div><b>Ability:</b> ${p.ability}</div>`;
										output += `<div><b>Tera Type:</b> <span style="font-weight: bold; color: #8a2be2;">${p.teraType || 'Normal'}</span></div>`;
										output += `<div style="margin-top: 5px;"><b>Moves:</b></div>`;
										output += `<ul>`;
										p.moves.forEach(move => {
												output += `<li>${move}</li>`;
										});
										output += `</ul>`;
										output += `<div style="margin-top: 5px;"><b>EVs:</b> ${Object.entries(p.evs).map(([stat, value]) => `<b>${value}</b> ${stat}`).join(' / ')}</div>`;
										output += `<div><b>Nature:</b> ${p.nature || 'Serious'}</div>`;
										output += `</div>`;
								});
								return this.sendReplyBox(output);
						}

						// Fallback to the old behavior of viewing a pre-defined team if a target is provided.
						const teamId = toID(target);
						const team = rentalTeams.get(teamId);
						if (!team) {
								return this.errorReply(`Team '${target}' not found. Use '/bt teamlist' to see available teams.`);
						}
						
						let output = `<b>${team.name} Team</b><br><br>`;
						team.pokemons.forEach(p => {
								output += `<div style="max-height: 300px; overflow: auto;">`;
								output += `<h3>${p.species}</h3>`;
								output += `<div><b>Item:</b> ${p.item || 'No Item'}</div>`;
								output += `<div><b>Ability:</b> ${p.ability}</div>`;
								output += `<div><b>Tera Type:</b> <span style="font-weight: bold; color: #8a2be2;">${p.teraType || 'Normal'}</span></div>`;
								output += `<div style="margin-top: 5px;"><b>Moves:</b></div>`;
								output += `<ul>`;
								p.moves.forEach(move => {
										output += `<li>${move}</li>`;
								});
								output += `</ul>`;
								output += `<div style="margin-top: 5px;"><b>EVs:</b> ${Object.entries(p.evs).map(([stat, value]) => `<b>${value}</b> ${stat}`).join(' / ')}</div>`;
								output += `<div><b>Nature:</b> ${p.nature || 'Serious'}</div>`;
								output += `</div>`;
						});

						return this.sendReplyBox(output);
				},

				teamlist(target, room, user) {
						const teams = [...rentalTeams.values()];
						if (teams.length === 0) {
								return this.sendReplyBox(`There are no rental Pokémon pools available at this time.`);
						}

						let output = `<b>Available Rental Pokémon Pools:</b><br><br>`;
						output += `The following teams provide the pool of Pokémon from which your and the bot's teams are generated. Your team will start with 1 random Pokémon, and a new one will be added for every 5 wins until you reach a full team of 6.<br><br>`;
						output += `<ul>`;
						teams.forEach(team => {
								output += `<li><span style="font-weight: bold;">${team.name}</span> (${team.id})</li>`;
						});
						output += `</ul>`;
						output += `<br>Use \`/bt start\` to begin your battle.`;
						return this.sendReplyBox(output);
				},

				streak(target, room, user) {
						const player = Users.get(target || user.name);
						if (!player) {
								return this.errorReply(`User '${target}' not found.`);
						}
						const currentStreak = winStreaks.get(player.id) || 0;
						const maxStreak = maxWinStreaks.get(player.id) || 0;
						return this.sendReply(`${player.name} has a current win streak of ${currentStreak} and a max win streak of ${maxStreak}.`);
				},
				
				top(target, room, user) {
						const allStreaks = [...maxWinStreaks.entries()].map(([userid, maxStreak]) => {
								const currentStreak = winStreaks.get(userid) || 0;
								return { userid, maxStreak, currentStreak };
						});
						
						const topStreaks = allStreaks
								.sort((a, b) => {
										if (b.maxStreak !== a.maxStreak) {
												return b.maxStreak - a.maxStreak;
										}
										return b.currentStreak - a.currentStreak;
								})
								.slice(0, 10);
						
						if (topStreaks.length === 0) {
								return this.sendReply(`There are no win streaks to display yet.`);
						}
						
						let output = `<div class="ladder"><table style="width:100%">`;
						output += `<tr><th>Rank</th><th>Player</th><th>Current Streak</th><th>Max Streak</th></tr>`;
						
						topStreaks.forEach((entry, index) => {
								const username = Users.get(entry.userid)?.name || entry.userid;
								output += `<tr><td>${index + 1}</td><td>${username}</td><td>${entry.currentStreak}</td><td>${entry.maxStreak}</td></tr>`;
						});
						
						output += `</table></div>`;
						return this.sendReplyBox(output);
				},
				
				help(target, room, user) {
						this.sendReplyBox(
								`/bt start - Starts a new Battle Tower match or resumes your current run.` +
								`<br>/bt teamlist - Shows the pool of available Pokémon used to generate teams.` +
								`<br>/bt viewteam - Displays your current Battle Tower team.` +
								`<br>/bt viewteam [teamid] - Displays a pre-defined team from the pool.` +
								`<br>/bt streak [username] - Checks the current and max win streaks of a player.` +
								`<br>/bt top - Displays the top 10 max win streaks.`
						);
				},
		},
};

export const handlers: Chat.Handlers = {
		onBattleEnd(
				battle: RoomBattle,
				winner: ID,
				players: ID[]
		) {
				if (battle.format !== 'gen9battletower') {
						return;
				}

				const room = Rooms.get(battle.roomid);
				if (!room) return;
				
				const botId = `${BOTID}` as ID;
				const humanPlayerId = players.find(p => p !== botId);
				const humanUser = humanPlayerId ? Users.get(humanPlayerId) : null;
				
				if (winner && winner !== botId) {
						// Human player won
						const currentWinnerStreak = (winStreaks.get(winner) || 0) + 1;
						winStreaks.set(winner, currentWinnerStreak);

						const maxWinnerStreak = maxWinStreaks.get(winner) || 0;
						if (currentWinnerStreak > maxWinnerStreak) {
								maxWinStreaks.set(winner, currentWinnerStreak);
						}

						const loser = players.find(p => p !== winner);
						if (loser) {
								winStreaks.set(loser, 0);
								currentTeams.delete(loser);
						}

						const winnerName = Users.get(winner)?.name;
						if (winnerName) {
								room.add(`|raw|<center><h3><b> Congratulations, ${winnerName}! You've won!</b></h3></center>`).update();
								room.add(`|raw|<center> Current Win Streak: ${winStreaks.get(winner)} (Max: ${maxWinStreaks.get(winner)})</center>`).update();
								room.add(`|raw|<center>Your team size for the next battle will be ${Math.min(6, Math.floor(winStreaks.get(winner)! / 5) + 1)} Pokémon.</center>`).update();
						}

						if (humanUser && humanUser.connected) {
								const viewTeamButton = `<button class="button" name="send" value="/bt viewteam">View Team</button>`;
								const startNextButton = `<button class="button" name="send" value="/bt start">Start Next Battle</button>`;
								humanUser.sendTo(room, `|raw|<center>${viewTeamButton} ${startNextButton}</center>`);
						}

				} else {
						// The bot won, or it was a draw
						if (humanUser) {
								winStreaks.set(humanPlayerId!, 0);
								currentTeams.delete(humanPlayerId!);
								
								if (humanUser.connected) {
										const startAgainButton = `<button class="button" name="send" value="/bt start">Try Again</button>`;
										humanUser.sendTo(room, `|raw|<center><h3><b>Defeat!</b></h3>` +
																				 `<br>Your Battle Tower run has ended` +
																				 `<br>${startAgainButton}</center>`);
								}
						}
				}
				
				if (humanPlayerId) {
						activeBattles.delete(humanPlayerId);
				}

				saveData();
		},
};
