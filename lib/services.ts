// Sync one player's Solo Queue rank/RR and today's real W/L from HenrikDev.
// Mutates db (adds/updates the daily soloq row) but does NOT save — caller saves.
export async function henrikSyncPlayer(db: any, player: string) {
  void db; void player;
  throw Object.assign(new Error('Legacy ranked sync is disabled. An eligible provider, explicit versioned consent, and exact account identity are required before any network request or write.'), { status: 503, code: 'ranked-sync-gate-unavailable' });
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
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return { success: false, error: 'Discord webhook is not configured in the deployment environment.', markdown };
  const discRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!discRes.ok) throw new Error(`Discord returned status ${discRes.status}`);
  return { success: true, markdown };
}
