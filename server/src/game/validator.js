const db = require("../db");

function normalizeName(name) {
  return name.trim().toLowerCase();
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

module.exports = { hasPlayedForBothTeams };
