const DEFAULT_SETTINGS = {
  teamSelectSeconds: 20,
  answerSeconds: 50,
  totalRounds: 5,
  negativeMarking: false,
  wrongAnswerPenalty: 10
};

const ALLOWED_PENALTIES = [10, 20, 30, 40];

const rooms = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeSettings(settings) {
  const raw = settings && typeof settings === "object" ? settings : {};

  const teamSelectSeconds = clamp(Number.parseInt(raw.teamSelectSeconds, 10) || DEFAULT_SETTINGS.teamSelectSeconds, 1, 999);
  const answerSeconds = clamp(Number.parseInt(raw.answerSeconds, 10) || DEFAULT_SETTINGS.answerSeconds, 1, 999);
  const totalRounds = clamp(Number.parseInt(raw.totalRounds, 10) || DEFAULT_SETTINGS.totalRounds, 1, 999);

  const penaltyValue = Number.parseInt(raw.wrongAnswerPenalty, 10);
  const wrongAnswerPenalty = ALLOWED_PENALTIES.includes(penaltyValue)
    ? penaltyValue
    : DEFAULT_SETTINGS.wrongAnswerPenalty;

  const negativeMarking =
    raw.negativeMarking === true ||
    raw.negativeMarking === "true" ||
    raw.negativeMarking === 1 ||
    raw.negativeMarking === "1";

  return {
    teamSelectSeconds,
    answerSeconds,
    totalRounds,
    negativeMarking,
    wrongAnswerPenalty
  };
}

function createRoom(roomId, settings) {
  if (rooms.has(roomId)) return false;

  rooms.set(roomId, {
    players: [],
    playerNames: {},
    ownerId: null,
    teams: {},
    scores: {},
    startReady: {},
    readyForNextRound: {},
    readyForRematch: {},
    answered: false,
    locked: false,
    phase: "lobby",
    roundNumber: 1,
    settings: sanitizeSettings(settings),
    lastResult: null,
    usedAnswersByMatchup: {}
  });

  return true;
}

function roomExists(roomId) {
  return rooms.has(roomId);
}

function joinRoom(roomId, socketId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;

  if (!room.players.includes(socketId) && room.players.length >= 2) {
    return false;
  }

  if (!room.players.includes(socketId)) {
    room.players.push(socketId);
  }

  room.playerNames[socketId] = playerName;

  if (!room.ownerId) {
    room.ownerId = socketId;
  }

  if (typeof room.scores[socketId] !== "number") {
    room.scores[socketId] = 0;
  }

  if (room.phase === "lobby") {
    room.startReady = {};
  }

  return true;
}

function isOwner(roomId, socketId) {
  const room = rooms.get(roomId);
  return !!room && room.ownerId === socketId;
}

function updateRoomSettings(roomId, socketId, nextSettings) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };
  if (!isOwner(roomId, socketId)) return { ok: false, reason: "NOT_OWNER" };
  if (room.phase !== "lobby") return { ok: false, reason: "SETTINGS_LOCKED" };

  room.settings = sanitizeSettings({
    ...room.settings,
    ...(nextSettings && typeof nextSettings === "object" ? nextSettings : {})
  });

  const resetStartReady = Object.keys(room.startReady).length > 0;
  room.startReady = {};

  return {
    ok: true,
    resetStartReady,
    settings: { ...room.settings }
  };
}

function markReadyToStart(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };
  if (room.phase !== "lobby") return { ok: false, reason: "LOBBY_NOT_ACTIVE" };
  if (!room.players.includes(socketId)) return { ok: false, reason: "PLAYER_NOT_IN_ROOM" };
  if (room.players.length < 2) return { ok: false, reason: "WAITING_FOR_PLAYERS" };

  room.startReady[socketId] = true;

  return {
    ok: true,
    readyCount: getStartReadyPlayerIds(roomId).length,
    totalRequired: room.players.length
  };
}

function allPlayersReadyToStart(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const readyCount = getStartReadyPlayerIds(roomId).length;
  return room.players.length === 2 && readyCount === room.players.length;
}

function startTeamSelection(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  room.teams = {};
  room.startReady = {};
  room.readyForNextRound = {};
  room.readyForRematch = {};
  room.answered = false;
  room.locked = false;
  room.phase = "team_selection";
  room.lastResult = null;

  return true;
}

function setTeam(roomId, socketId, team) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };
  if (!room.players.includes(socketId)) return { ok: false, reason: "PLAYER_NOT_IN_ROOM" };
  if (room.phase !== "team_selection") return { ok: false, reason: "TEAM_SELECTION_NOT_ACTIVE" };
  if (room.locked) return { ok: false, reason: "TEAMS_LOCKED" };

  const existingTeam = room.teams[socketId];
  if (existingTeam === team) {
    return {
      ok: true,
      ready: Object.keys(room.teams).length === 2,
      selectedCount: Object.keys(room.teams).length
    };
  }

  room.teams[socketId] = team;

  const selectedCount = Object.keys(room.teams).length;
  if (selectedCount === 2) {
    room.locked = true;
    room.phase = "guessing";

    return {
      ok: true,
      ready: true,
      selectedCount
    };
  }

  return {
    ok: true,
    ready: false,
    selectedCount
  };
}

function makeMatchupKey(teamA, teamB) {
  const safeA = String(teamA || "").trim().toUpperCase();
  const safeB = String(teamB || "").trim().toUpperCase();

  return [safeA, safeB].sort().join("__");
}

function normalizeAnswerKey(playerName) {
  return String(playerName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isAnswerUsedForMatchup(roomId, teamA, teamB, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const matchupKey = makeMatchupKey(teamA, teamB);
  const answerKey = normalizeAnswerKey(playerName);
  const usedMap = room.usedAnswersByMatchup || {};
  const usedSet = usedMap[matchupKey];

  if (!answerKey || !(usedSet instanceof Set)) return false;
  return usedSet.has(answerKey);
}

function markAnswerUsedForMatchup(roomId, teamA, teamB, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const matchupKey = makeMatchupKey(teamA, teamB);
  const answerKey = normalizeAnswerKey(playerName);

  if (!answerKey) return false;

  if (!room.usedAnswersByMatchup) {
    room.usedAnswersByMatchup = {};
  }

  if (!(room.usedAnswersByMatchup[matchupKey] instanceof Set)) {
    room.usedAnswersByMatchup[matchupKey] = new Set();
  }

  room.usedAnswersByMatchup[matchupKey].add(answerKey);
  return true;
}

function getAllUsedAnswers(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.usedAnswersByMatchup) return [];

  const allUsed = new Set();
  for (const matchupKey in room.usedAnswersByMatchup) {
    const matchupSet = room.usedAnswersByMatchup[matchupKey];
    if (matchupSet instanceof Set) {
      for (const answer of matchupSet) {
        allUsed.add(answer);
      }
    }
  }
  return Array.from(allUsed);
}

function canSubmitAnswer(roomId) {
  const room = rooms.get(roomId);
  return !!room && room.phase === "guessing" && !room.answered;
}

function addScore(roomId, socketId, delta) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (typeof room.scores[socketId] !== "number") return null;

  room.scores[socketId] += Number(delta) || 0;
  return room.scores[socketId];
}

function finishRound(roomId, { winnerId = null, answer = "", reason = "", scoreDelta = 0 } = {}) {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.answered = true;
  room.phase = "round_complete";
  room.locked = true;
  room.readyForNextRound = {};

  if (winnerId && typeof room.scores[winnerId] === "number") {
    room.scores[winnerId] += Number(scoreDelta) || 0;
  }

  room.lastResult = {
    winnerId,
    answer,
    reason,
    scoreDelta: Number(scoreDelta) || 0
  };

  return room.lastResult;
}

function markReadyForNextRound(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };
  if (room.phase !== "round_complete") return { ok: false, reason: "ROUND_NOT_COMPLETE" };
  if (!room.players.includes(socketId)) return { ok: false, reason: "PLAYER_NOT_IN_ROOM" };

  room.readyForNextRound[socketId] = true;

  return {
    ok: true,
    readyCount: getReadyPlayerIds(roomId).length,
    totalRequired: room.players.length
  };
}

function allPlayersReady(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const readyCount = getReadyPlayerIds(roomId).length;
  return room.players.length === 2 && readyCount === room.players.length;
}

function markReadyForRematch(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };
  if (room.phase !== "game_over") return { ok: false, reason: "GAME_NOT_OVER" };
  if (!room.players.includes(socketId)) return { ok: false, reason: "PLAYER_NOT_IN_ROOM" };
  if (room.players.length < 2) return { ok: false, reason: "WAITING_FOR_PLAYERS" };

  room.readyForRematch[socketId] = true;

  return {
    ok: true,
    readyCount: getRematchReadyPlayerIds(roomId).length,
    totalRequired: room.players.length
  };
}

function allPlayersReadyForRematch(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const readyCount = getRematchReadyPlayerIds(roomId).length;
  return room.players.length === 2 && readyCount === room.players.length;
}

function advanceRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: "ROOM_NOT_FOUND" };

  room.roundNumber += 1;

  if (room.roundNumber > room.settings.totalRounds) {
    room.phase = "game_over";
    room.readyForNextRound = {};
    room.readyForRematch = {};
    return { ok: true, gameOver: true, roundNumber: room.roundNumber };
  }

  startTeamSelection(roomId);

  return {
    ok: true,
    gameOver: false,
    roundNumber: room.roundNumber
  };
}

function setGameOver(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.phase = "game_over";
  room.startReady = {};
  room.readyForNextRound = {};
  room.readyForRematch = {};
}

function resetMatch(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  room.phase = "lobby";
  room.roundNumber = 1;
  room.teams = {};
  room.locked = false;
  room.answered = false;
  room.startReady = {};
  room.readyForNextRound = {};
  room.readyForRematch = {};
  room.lastResult = null;
  room.usedAnswersByMatchup = {};

  room.players.forEach((id) => {
    room.scores[id] = 0;
  });

  return true;
}

function getOwnerId(roomId) {
  return rooms.get(roomId)?.ownerId || null;
}

function getOpponentId(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  return room.players.find((id) => id !== socketId) || null;
}

function getTeams(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const ids = Object.keys(room.teams);
  if (ids.length < 2) return null;

  return {
    teamA: room.teams[ids[0]],
    teamB: room.teams[ids[1]]
  };
}

function getPlayerCount(roomId) {
  return rooms.get(roomId)?.players.length || 0;
}

function getSelectedTeamCount(roomId) {
  const room = rooms.get(roomId);
  return room ? Object.keys(room.teams).length : 0;
}

function getPlayerName(roomId, socketId) {
  const room = rooms.get(roomId);
  return room?.playerNames[socketId] || "Player";
}

function getPlayers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return room.players.map((id) => ({
    id,
    name: room.playerNames[id] || "Player"
  }));
}

function getScores(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return room.players
    .map((id) => ({
      id,
      name: room.playerNames[id] || "Player",
      score: room.scores[id] || 0
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function getRoundInfo(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  return {
    current: Math.min(room.roundNumber, room.settings.totalRounds),
    total: room.settings.totalRounds
  };
}

function getRoomSettings(roomId) {
  const room = rooms.get(roomId);
  return room ? { ...room.settings } : null;
}

function getRoomPhase(roomId) {
  return rooms.get(roomId)?.phase || null;
}

function getStartReadyPlayerIds(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return room.players.filter((id) => room.startReady[id]);
}

function getReadyPlayerIds(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return room.players.filter((id) => room.readyForNextRound[id]);
}

function getRematchReadyPlayerIds(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return room.players.filter((id) => room.readyForRematch[id]);
}

function getRoomState(roomId, viewerId = null) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const selectedPlayerIds = Object.keys(room.teams);
  const selectedCount = selectedPlayerIds.length;
  const hideOpponentTeams = room.phase === "team_selection" && selectedCount < 2 && !!viewerId;

  const teamSelections = selectedPlayerIds.map((playerId) => {
    const visibleTeam = hideOpponentTeams && playerId !== viewerId ? "Locked" : room.teams[playerId];

    return {
      playerId,
      playerName: room.playerNames[playerId] || "Player",
      team: visibleTeam
    };
  });

  const readyPlayerIds = getReadyPlayerIds(roomId);
  const startReadyPlayerIds = getStartReadyPlayerIds(roomId);
  const rematchReadyPlayerIds = getRematchReadyPlayerIds(roomId);

  return {
    roomId,
    phase: room.phase,
    playerCount: room.players.length,
    players: getPlayers(roomId),
    ownerId: room.ownerId,
    ownerName: room.playerNames[room.ownerId] || "Admin",
    settings: { ...room.settings },
    round: getRoundInfo(roomId),
    selectedTeamCount: selectedCount,
    selectedTeams: selectedCount === 2 ? getTeams(roomId) : null,
    teamSelections,
    scores: getScores(roomId),
    startReadyPlayerIds,
    startReadyPlayers: startReadyPlayerIds.map((id) => room.playerNames[id] || "Player"),
    readyPlayerIds,
    readyPlayers: readyPlayerIds.map((id) => room.playerNames[id] || "Player"),
    rematchReadyPlayerIds,
    rematchReadyPlayers: rematchReadyPlayerIds.map((id) => room.playerNames[id] || "Player"),
    gameOver: room.phase === "game_over",
    lastResult: room.lastResult
  };
}

function removePlayer(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { deleted: false, playerCount: 0 };

  room.players = room.players.filter((id) => id !== socketId);
  delete room.playerNames[socketId];
  delete room.teams[socketId];
  delete room.scores[socketId];
  delete room.startReady[socketId];
  delete room.readyForNextRound[socketId];
  delete room.readyForRematch[socketId];

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return { deleted: true, playerCount: 0 };
  }

  if (room.ownerId === socketId) {
    room.ownerId = room.players[0] || null;
  }

  room.phase = "lobby";
  room.roundNumber = 1;
  room.teams = {};
  room.locked = false;
  room.answered = false;
  room.startReady = {};
  room.readyForNextRound = {};
  room.readyForRematch = {};
  room.lastResult = null;
  room.usedAnswersByMatchup = {};

  room.players.forEach((id) => {
    room.scores[id] = 0;
  });

  return {
    deleted: false,
    playerCount: room.players.length
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  ALLOWED_PENALTIES,
  createRoom,
  roomExists,
  joinRoom,
  isOwner,
  updateRoomSettings,
  markReadyToStart,
  allPlayersReadyToStart,
  startTeamSelection,
  setTeam,
  canSubmitAnswer,
  isAnswerUsedForMatchup,
  markAnswerUsedForMatchup,
  addScore,
  finishRound,
  markReadyForNextRound,
  allPlayersReady,
  markReadyForRematch,
  allPlayersReadyForRematch,
  advanceRound,
  setGameOver,
  resetMatch,
  getOwnerId,
  getOpponentId,
  getTeams,
  getPlayerCount,
  getSelectedTeamCount,
  getPlayerName,
  getPlayers,
  getScores,
  getRoundInfo,
  getRoomSettings,
  getRoomPhase,
  getStartReadyPlayerIds,
  getReadyPlayerIds,
  getRematchReadyPlayerIds,
  getRoomState,
  removePlayer,
  getAllUsedAnswers
};




