const db = require("../db");

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function getRandomValidPlayer(teamA, teamB, excludedPlayers = []) {
  let query = `
    SELECT player_name
    FROM team_players
    WHERE team IN (?, ?)
  `;
  const params = [teamA, teamB];

  if (excludedPlayers && excludedPlayers.length > 0) {
    const placeholders = excludedPlayers.map(() => '?').join(', ');
    query += ` AND LOWER(player_name) NOT IN (${placeholders}) `;
    params.push(...excludedPlayers.map(name => normalizeName(name)));
  }

  query += `
    GROUP BY player_name
    HAVING COUNT(DISTINCT team) = 2
    ORDER BY RANDOM()
    LIMIT 1
  `;

  const stmt = db.prepare(query);
  const result = stmt.get(...params);
  return result ? result.player_name : null;
}

function hasPlayedForBothTeams(teamA, teamB, playerName) {
  const stmt = db.prepare(`
    SELECT player_name
    FROM team_players
    WHERE team IN (?, ?)
      AND LOWER(player_name) = ?
    GROUP BY player_name
    HAVING COUNT(DISTINCT team) = 2
  `);

  const result = stmt.get(
    teamA,
    teamB,
    normalizeName(playerName)
  );

  return !!result;
}

module.exports = { hasPlayedForBothTeams, getRandomValidPlayer };
