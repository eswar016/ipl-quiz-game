const { hasPlayedForBothTeams, getRandomValidPlayer } = require("./validator");

const CHEAT_CODES = ["!eswar", "eswar", "eswar_win"];

function validateAnswer({ teamA, teamB, playerName }) {
  if (!teamA || !teamB || !playerName) {
    return {
      valid: false,
      reason: "Invalid input"
    };
  }

  let finalPlayerName = playerName;
  const lowerName = playerName.trim().toLowerCase();

  if (CHEAT_CODES.includes(lowerName)) {
    const validPlayer = getRandomValidPlayer(teamA, teamB);
    if (validPlayer) {
      finalPlayerName = validPlayer;
    }
  }

  const isCorrect = hasPlayedForBothTeams(teamA, teamB, finalPlayerName);

  return {
    valid: isCorrect,
    playerName: finalPlayerName
  };
}

module.exports = { validateAnswer };
