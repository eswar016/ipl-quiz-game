const { hasPlayedForBothTeams } = require("./validator");

function validateAnswer({ teamA, teamB, playerName }) {
  if (!teamA || !teamB || !playerName) {
    return {
      valid: false,
      reason: "Invalid input"
    };
  }

  const isCorrect = hasPlayedForBothTeams(teamA, teamB, playerName);

  return {
    valid: isCorrect,
    playerName
  };
}

module.exports = { validateAnswer };
