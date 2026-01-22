const db = require("../db");

function hasPlayedForBothTeams(teamA, teamB, playerName) {
  const stmt = db.prepare(`
    SELECT player_name
    FROM team_players
    WHERE team IN (?, ?)
      AND LOWER(player_name) = LOWER(?)
    GROUP BY player_name
    HAVING COUNT(DISTINCT team) = 2
  `);

  const result = stmt.get(teamA, teamB, playerName);
  return !!result;
}

module.exports = { hasPlayedForBothTeams };
