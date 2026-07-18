import { uid } from './utils';

// Sync one player's Solo Queue rank/RR and today's real W/L from HenrikDev.
// Mutates db (adds/updates the daily soloq row) but does NOT save — caller saves.
export async function henrikSyncPlayer(db: any, player: string) {
  const rid = db.settings.riotIds?.[player];
  if (!rid || !rid.name || !rid.tag) {
    throw Object.assign(new Error(`Riot ID is not configured for ${player} in Settings.`), { status: 400 });
  }
  const apiKey = process.env.HENRIK_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('HenrikDev API key is not configured. Add it in Settings to sync Solo Queue.'), { status: 400 });
  }

  const region = rid.region || 'eu';
  const rName = encodeURIComponent(rid.name);
  const rTag = encodeURIComponent(rid.tag);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Current rank + RR (authoritative endpoint).
  const respMMR = await fetch(`https://api.henrikdev.xyz/valorant/v3/mmr/${region}/pc/${rName}/${rTag}`, {
    headers: { Authorization: apiKey }
  });
  if (!respMMR.ok) {
    throw Object.assign(new Error(`HenrikDev MMR lookup failed for ${player} (status ${respMMR.status}).`), { status: 502 });
  }
  const mmrData = await respMMR.json();
  let rank = 'Unranked';
  let rr: number | string = 0;
  if (mmrData?.data?.current) {
    rank = mmrData.data.current.tier?.name || rank;
    rr = mmrData.data.current.rr ?? rr;
  }

  // Real W/L for today from stored competitive matches. Best-effort: if the shape
  // is unexpected we leave counts at 0 rather than fabricate anything.
  let wins = 0;
  let losses = 0;
  try {
    const respMatches = await fetch(`https://api.henrikdev.xyz/valorant/v1/stored-matches/${region}/${rName}/${rTag}?mode=competitive&size=20`, {
      headers: { Authorization: apiKey }
    });
    if (respMatches.ok) {
      const md = await respMatches.json();
      const matches = Array.isArray(md?.data) ? md.data : [];
      for (const m of matches) {
        const dateStr = String(m?.meta?.started_at || '').slice(0, 10);
        if (dateStr && dateStr !== todayStr) continue;
        const team = String(m?.stats?.team || '').toLowerCase();
        const teams = m?.teams || {};
        if (team === 'red' || team === 'blue') {
          const mine = Number(teams[team]);
          const theirs = Number(teams[team === 'red' ? 'blue' : 'red']);
          if (!isNaN(mine) && !isNaN(theirs)) {
            if (mine > theirs) wins++;
            else if (mine < theirs) losses++;
          }
        }
      }
    }
  } catch {
    console.warn(`Henrik stored-matches W/L lookup failed for ${player}; leaving W/L at 0.`);
  }

  const existingIdx = db.soloq.findIndex((x: any) => x.player === player && x.date === todayStr && x.source === 'henrik');
  const row = { id: existingIdx >= 0 ? db.soloq[existingIdx].id : uid(), date: todayStr, player, wins, losses, rank, rr, source: 'henrik' };
  if (existingIdx >= 0) db.soloq[existingIdx] = row;
  else db.soloq.push(row);
  return { player, rank, rr, wins, losses };
}

// Build a Discord report (markdown + rich embed payload) for a saved match.
export function buildDiscordReport(db: any, match: any) {
  const stats = db.playerStats.filter((s: any) => s.matchId === match.id);
  const rounds = db.rounds.filter((r: any) => r.matchId === match.id);
  const throws = rounds.filter((r: any) => r.isThrow === 'TRUE' || r.isThrow === true);

  const ourScore = match.attW + match.defW;
  const enemyScore = match.attL + match.defL;
  const isWin = ourScore > enemyScore;
  const resultStr = isWin ? '🏆 VICTORY' : ourScore < enemyScore ? '❌ DEFEAT' : '🤝 DRAW';
  const resultColor = isWin ? 0x22c55e : ourScore < enemyScore ? 0xef4444 : 0x94a3b8;
  const teamName = db.settings.teamName || 'Vandals Esports';

  let mvpPlayer = 'N/A';
  let maxAcs = -1;
  stats.forEach((s: any) => {
    if (s.acs && s.acs > maxAcs) { maxAcs = s.acs; mvpPlayer = s.player; }
  });

  const markdown = `
# ${resultStr} | Scrim Report vs **${match.opponent}**
**Map:** ${match.map} | **Score:** ${ourScore} - ${enemyScore}
**Match Type:** ${match.type} | **Date:** ${match.date}

### 📊 Scoreboard Summary
${stats.map((s: any) => `• **${s.player}** (${s.agent}): ${s.kills}K / ${s.deaths}D / ${s.assists}A | ACS: **${s.acs || '-'}** | ADR: **${s.adr || '-'}**`).join('\n')}

### 🎯 Tactical Summary
• **Pistol Rounds:** Attack: ${match.pistolAtt || '-'} | Defense: ${match.pistolDef || '-'}
• **Round Throws Count:** ${throws.length}
• **Match MVP:** **${mvpPlayer}** (ACS: ${maxAcs > 0 ? maxAcs : '-'})

---
### 🧠 AI Coach Tactical Briefing
${match.aiAnalysis ? match.aiAnalysis : '_No AI Analysis generated yet._'}
`;

  const payload = {
    username: `${teamName} Coach Bot`,
    embeds: [
      {
        title: `${resultStr} vs ${match.opponent} on ${match.map}`,
        color: resultColor,
        fields: [
          { name: 'Score', value: `**${ourScore} - ${enemyScore}**`, inline: true },
          { name: 'Match Type', value: match.type, inline: true },
          { name: 'Date', value: match.date, inline: true },
          { name: 'MVP', value: `⭐ **${mvpPlayer}** (ACS: ${maxAcs})`, inline: true },
          { name: 'First Bloods', value: `🎯 ${rounds.filter((r: any) => r.firstKillBy && stats.some((s: any) => s.player === r.firstKillBy)).length}`, inline: true },
          { name: 'Throws/Chokes', value: `⚠️ ${throws.length} rounds`, inline: true }
        ],
        description: `### 🧠 AI Coaching Digest\n${match.aiAnalysis ? (match.aiAnalysis.substring(0, 1000) + (match.aiAnalysis.length > 1000 ? '\n... *(Brief truncated, view in dashboard)*' : '')) : '*No AI analysis available for this match.*'}`,
        footer: { text: `Powered by ${teamName} Scrim Engine • ${new Date().toLocaleDateString()}` }
      }
    ]
  };

  return { markdown, payload };
}

// Post a match report to the configured Discord webhook. Throws on a webhook HTTP error.
export async function postDiscordReport(db: any, matchId: string): Promise<{ success: boolean; markdown?: string; error?: string }> {
  const match = db.matches.find((m: any) => m.id === matchId);
  if (!match) return { success: false, error: 'Match not found.' };
  const { markdown, payload } = buildDiscordReport(db, match);
  const webhookUrl = db.settings.discordWebhook;
  if (!webhookUrl) return { success: false, error: 'Discord Webhook URL not configured in Settings.', markdown };
  const discRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!discRes.ok) throw new Error(`Discord returned status ${discRes.status}`);
  return { success: true, markdown };
}
