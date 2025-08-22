export class RandomRegionTierTeams extends RandomTeams {
  randomTeam(side: 'p1' | 'p2') {
    const team = [];

    // Determine tier from format ID
    let tier: 'ou' | 'uu' | 'ru' = 'ou';
    if (this.format.id.includes('uu')) tier = 'uu';
    if (this.format.id.includes('ru')) tier = 'ru';

    // Pick regions once per battle
    if (!this.battle.regionMatchup) {
      const allRegions = Object.keys(regionPools[tier]);
      const p1Region = this.sample(allRegions);
      const p2Region = this.sample(allRegions.filter(r => r !== p1Region));
      this.battle.regionMatchup = {p1: p1Region, p2: p2Region};
      this.battle.add(`message|${tier.toUpperCase()} Region Matchup: ${p1Region.toUpperCase()} vs ${p2Region.toUpperCase()}`);
    }

    const region = side === 'p1'
      ? this.battle.regionMatchup.p1
      : this.battle.regionMatchup.p2;

    const pool = this.sampleMany(regionPools[tier][region], 6);

    for (const species of pool) {
      team.push(this.randomSet(species)); // full competitive set
    }

    return team;
  }
}
