const { Server } = require("socket.io");
const {
  createRoom,
  roomExists,
  joinRoom,
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
  removePlayer
} = require("./game/roomManager");
const { validateAnswer } = require("./game/gameLogic");

const roomTimers = new Map();

function normalizeRoomId(roomId) {
  return String(roomId || "").trim();
}

function normalizeTeam(team) {
  return String(team || "").trim().toUpperCase();
}

function normalizePlayerName(playerName) {
  return String(playerName || "").trim();
}

function normalizeUserName(username) {
  return String(username || "").trim();
}

function calculateSpeedScore(totalSeconds, secondsLeft) {
  const safeTotal = Math.max(1, Number(totalSeconds) || 50);
  const boundedLeft = Math.max(0, Math.min(safeTotal, Number(secondsLeft) || 0));

  return Math.max(5, Math.ceil((boundedLeft / safeTotal) * 100));
}

function extractRoomId(payload) {
  if (typeof payload === "string") return normalizeRoomId(payload);
  if (payload && typeof payload === "object") return normalizeRoomId(payload.roomId);
  return "";
}

function getTimerBucket(roomId) {
  if (!roomTimers.has(roomId)) {
    roomTimers.set(roomId, {
      teamSelectionIntervalId: null,
      teamSelectionSecondsLeft: null,
      sameTeamRetryTimeoutId: null,
      answerIntervalId: null,
      answerSecondsLeft: null
    });
  }

  return roomTimers.get(roomId);
}

function clearTeamSelectionTimer(roomId) {
  const bucket = roomTimers.get(roomId);
  if (!bucket) return;

  if (bucket.teamSelectionIntervalId) {
    clearInterval(bucket.teamSelectionIntervalId);
    bucket.teamSelectionIntervalId = null;
  }

  if (bucket.sameTeamRetryTimeoutId) {
    clearTimeout(bucket.sameTeamRetryTimeoutId);
    bucket.sameTeamRetryTimeoutId = null;
  }

  bucket.teamSelectionSecondsLeft = null;

  if (!bucket.answerIntervalId && !bucket.sameTeamRetryTimeoutId) {
    roomTimers.delete(roomId);
  }
}

function clearAnswerTimer(roomId) {
  const bucket = roomTimers.get(roomId);
  if (!bucket) return;

  if (bucket.answerIntervalId) {
    clearInterval(bucket.answerIntervalId);
    bucket.answerIntervalId = null;
  }

  bucket.answerSecondsLeft = null;

  if (!bucket.teamSelectionIntervalId && !bucket.sameTeamRetryTimeoutId) {
    roomTimers.delete(roomId);
  }
}

function clearAllTimers(roomId) {
  clearTeamSelectionTimer(roomId);
  clearAnswerTimer(roomId);
}

function getAnswerSecondsLeft(roomId) {
  const bucket = roomTimers.get(roomId);
  if (!bucket) return null;
  if (typeof bucket.answerSecondsLeft !== "number") return null;
  return bucket.answerSecondsLeft;
}

function calculateForfeitScore(roomId) {
  const settings = getRoomSettings(roomId);
  if (!settings) return 25;

  if (getRoomPhase(roomId) === "guessing") {
    return calculateSpeedScore(settings.answerSeconds, getAnswerSecondsLeft(roomId));
  }

  return 25;
}

function emitRoomState(io, roomId) {
  const players = getPlayers(roomId);
  if (!players.length) return;

  players.forEach((player) => {
    const state = getRoomState(roomId, player.id);
    if (state) {
      io.to(player.id).emit("room_state", state);
    }
  });
}

function emitLobbyStartStatus(io, roomId) {
  const players = getPlayers(roomId);
  const readyPlayerIds = getStartReadyPlayerIds(roomId);
  const readyPlayers = players.filter((player) => readyPlayerIds.includes(player.id)).map((player) => player.name);
  const waitingFor = players.filter((player) => !readyPlayerIds.includes(player.id)).map((player) => player.name);

  io.to(roomId).emit("lobby_start_status", {
    readyCount: readyPlayerIds.length,
    totalRequired: Math.min(players.length, 2),
    readyPlayerIds,
    readyPlayers,
    waitingFor,
    canStart: players.length === 2
  });
}

function emitTeamSelectionProgress(io, roomId) {
  io.to(roomId).emit("team_selection_progress", {
    selectedCount: getSelectedTeamCount(roomId),
    totalRequired: 2,
    waitingForOther: getSelectedTeamCount(roomId) === 1,
    playerCount: getPlayerCount(roomId)
  });
}

function emitNextRoundStatus(io, roomId) {
  const players = getPlayers(roomId);
  const readyPlayerIds = getReadyPlayerIds(roomId);
  const readyPlayers = players.filter((player) => readyPlayerIds.includes(player.id)).map((player) => player.name);
  const waitingFor = players.filter((player) => !readyPlayerIds.includes(player.id)).map((player) => player.name);

  io.to(roomId).emit("next_round_status", {
    readyCount: readyPlayerIds.length,
    totalRequired: players.length,
    readyPlayerIds,
    readyPlayers,
    waitingFor
  });
}

function emitRematchStatus(io, roomId) {
  const players = getPlayers(roomId);
  const readyPlayerIds = getRematchReadyPlayerIds(roomId);
  const readyPlayers = players.filter((player) => readyPlayerIds.includes(player.id)).map((player) => player.name);
  const waitingFor = players.filter((player) => !readyPlayerIds.includes(player.id)).map((player) => player.name);

  io.to(roomId).emit("rematch_status", {
    readyCount: readyPlayerIds.length,
    totalRequired: players.length,
    readyPlayerIds,
    readyPlayers,
    waitingFor
  });
}

function maybeCompleteMatchAfterRound(io, roomId, reason = "final_round_completed") {
  const roundInfo = getRoundInfo(roomId);
  if (!roundInfo) return false;
  if (roundInfo.current < roundInfo.total) return false;

  setGameOver(roomId);

  const scores = getScores(roomId);
  const winner = scores[0] || null;

  io.to(roomId).emit("game_over", {
    message: "Match complete.",
    round: roundInfo,
    scores,
    winnerId: winner?.id || null,
    winnerName: winner?.name || null,
    reason
  });

  emitRoomState(io, roomId);
  return true;
}

function startSameTeamRetryWindow(io, roomId, retrySeconds = 4) {
  clearTeamSelectionTimer(roomId);

  const parsed = Number(retrySeconds);
  const safeRetrySeconds = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4;

  const bucket = getTimerBucket(roomId);
  if (bucket.sameTeamRetryTimeoutId) {
    clearTimeout(bucket.sameTeamRetryTimeoutId);
  }

  bucket.sameTeamRetryTimeoutId = setTimeout(() => {
    const activeBucket = roomTimers.get(roomId);
    if (activeBucket) {
      activeBucket.sameTeamRetryTimeoutId = null;
      if (!activeBucket.teamSelectionIntervalId && !activeBucket.answerIntervalId) {
        roomTimers.delete(roomId);
      }
    }

    if (getRoomPhase(roomId) !== "team_selection" || getPlayerCount(roomId) < 2) {
      return;
    }

    io.to(roomId).emit("same_team_retry_complete", {
      message: "Choose teams again."
    });

    emitRoomState(io, roomId);
    emitTeamSelectionProgress(io, roomId);
    startTeamSelectionTimer(io, roomId);
  }, safeRetrySeconds * 1000);
}

function startTeamSelectionTimer(io, roomId, initialSecondsOverride = null) {
  clearTeamSelectionTimer(roomId);

  const settings = getRoomSettings(roomId);
  if (!settings) return;

  const bucket = getTimerBucket(roomId);
  const overrideSeconds = Number(initialSecondsOverride);
  const teamSelectionSeconds = Number.isFinite(overrideSeconds) && overrideSeconds > 0
    ? Math.floor(overrideSeconds)
    : settings.teamSelectSeconds;

  bucket.teamSelectionSecondsLeft = teamSelectionSeconds;
  let secondsLeft = bucket.teamSelectionSecondsLeft;

  io.to(roomId).emit("team_selection_timer", { secondsLeft });

  bucket.teamSelectionIntervalId = setInterval(() => {
    if (getRoomPhase(roomId) !== "team_selection") {
      clearTeamSelectionTimer(roomId);
      return;
    }

    secondsLeft -= 1;
    bucket.teamSelectionSecondsLeft = secondsLeft;
    io.to(roomId).emit("team_selection_timer", { secondsLeft });

    if (secondsLeft <= 0) {
      clearTeamSelectionTimer(roomId);

      const result = finishRound(roomId, {
        reason: "team_selection_timeout",
        answer: ""
      });

      if (!result) return;

      io.to(roomId).emit("team_selection_timeout", {
        message: "Team selection time ended. No winner this round."
      });

      io.to(roomId).emit("round_timeout", {
        reason: "team_selection_timeout",
        message: "Team selection time ended. No winner this round.",
        scores: getScores(roomId),
        round: getRoundInfo(roomId)
      });

      if (maybeCompleteMatchAfterRound(io, roomId, "team_selection_timeout")) {
        return;
      }

      emitRoomState(io, roomId);
      emitNextRoundStatus(io, roomId);
    }
  }, 1000);
}

function startAnswerTimer(io, roomId) {
  clearAnswerTimer(roomId);

  const settings = getRoomSettings(roomId);
  if (!settings) return;

  const bucket = getTimerBucket(roomId);
  bucket.answerSecondsLeft = settings.answerSeconds;
  let secondsLeft = bucket.answerSecondsLeft;

  io.to(roomId).emit("round_timer", { secondsLeft });

  bucket.answerIntervalId = setInterval(() => {
    if (getRoomPhase(roomId) !== "guessing") {
      clearAnswerTimer(roomId);
      return;
    }

    secondsLeft -= 1;
    bucket.answerSecondsLeft = secondsLeft;
    io.to(roomId).emit("round_timer", { secondsLeft });

    if (secondsLeft <= 0) {
      clearAnswerTimer(roomId);

      const result = finishRound(roomId, {
        reason: "answer_timeout",
        answer: ""
      });

      if (!result) return;

      io.to(roomId).emit("round_timeout", {
        reason: "answer_timeout",
        message: "Time up. No winner this round.",
        scores: getScores(roomId),
        round: getRoundInfo(roomId)
      });

      if (maybeCompleteMatchAfterRound(io, roomId, "answer_timeout")) {
        return;
      }

      emitRoomState(io, roomId);
      emitNextRoundStatus(io, roomId);
    }
  }, 1000);
}

function resolveCreatePayload(payload, socketId) {
  if (typeof payload === "string") {
    return {
      roomId: normalizeRoomId(payload),
      username: `Player-${socketId.slice(-4)}`,
      settings: {}
    };
  }

  const raw = payload && typeof payload === "object" ? payload : {};
  return {
    roomId: normalizeRoomId(raw.roomId),
    username: normalizeUserName(raw.username),
    settings: raw.settings || {}
  };
}

function resolveJoinPayload(payload, socketId) {
  if (typeof payload === "string") {
    return {
      roomId: normalizeRoomId(payload),
      username: `Player-${socketId.slice(-4)}`
    };
  }

  const raw = payload && typeof payload === "object" ? payload : {};
  return {
    roomId: normalizeRoomId(raw.roomId),
    username: normalizeUserName(raw.username)
  };
}

function initSocket(server) {
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    const handleLeaveRoom = (roomId, options = {}) => {
      const { emitToSocket = false, removeSocketFromChannel = true } = options;
      if (!roomId) return;

      clearAllTimers(roomId);

      const leaverName = getPlayerName(roomId, socket.id);
      const removed = removePlayer(roomId, socket.id);

      if (removeSocketFromChannel) {
        socket.leave(roomId);
      }

      if (emitToSocket) {
        socket.emit("left_room", { roomId });
      }

      if (removed.deleted) {
        clearAllTimers(roomId);
        return;
      }

      io.to(roomId).emit("player_left", {
        message: `${leaverName} left the room.`,
        playerCount: getPlayerCount(roomId),
        players: getPlayers(roomId)
      });

      emitRoomState(io, roomId);
      emitLobbyStartStatus(io, roomId);
    };

    socket.on("create_room", (payload) => {
      const { roomId, username, settings } = resolveCreatePayload(payload, socket.id);

      if (!roomId) {
        socket.emit("room_error", { context: "create_room", message: "Enter a valid room ID." });
        return;
      }

      if (!username) {
        socket.emit("room_error", { context: "create_room", message: "Enter your name before creating a room." });
        return;
      }

      if (roomExists(roomId)) {
        const existingPlayerCount = getPlayerCount(roomId);
        socket.emit("room_error", {
          context: "create_room",
          message:
            existingPlayerCount < 2
              ? "Room already created. Press Join to enter the room."
              : "Room already created. Create another with another Room ID."
        });
        return;
      }

      const created = createRoom(roomId, settings);
      if (!created) {
        socket.emit("room_error", { context: "create_room", message: "Unable to create room." });
        return;
      }

      const joined = joinRoom(roomId, socket.id, username);
      if (!joined) {
        socket.emit("room_error", { context: "create_room", message: "Unable to join the room you created." });
        return;
      }

      socket.join(roomId);
      socket.emit("room_created", {
        roomId,
        username,
        settings: getRoomSettings(roomId),
        round: getRoundInfo(roomId)
      });

      io.to(roomId).emit("player_joined", {
        playerCount: getPlayerCount(roomId),
        players: getPlayers(roomId)
      });

      emitRoomState(io, roomId);
      emitLobbyStartStatus(io, roomId);
    });

    socket.on("join_room", (payload) => {
      const { roomId, username } = resolveJoinPayload(payload, socket.id);

      if (!roomId) {
        socket.emit("room_error", { context: "join_room", message: "Enter a valid room ID." });
        return;
      }

      if (!username) {
        socket.emit("room_error", { context: "join_room", message: "Enter your name before joining." });
        return;
      }

      if (!roomExists(roomId)) {
        socket.emit("room_error", { context: "join_room", message: "Room not found." });
        return;
      }

      const joined = joinRoom(roomId, socket.id, username);
      if (!joined) {
        socket.emit("room_error", { context: "join_room", message: "Room is already full." });
        return;
      }

      socket.join(roomId);
      socket.emit("room_joined", {
        roomId,
        username,
        settings: getRoomSettings(roomId),
        round: getRoundInfo(roomId)
      });

      io.to(roomId).emit("player_joined", {
        playerCount: getPlayerCount(roomId),
        players: getPlayers(roomId)
      });

      emitRoomState(io, roomId);
      emitLobbyStartStatus(io, roomId);
    });

    socket.on("update_room_settings", (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      const updated = updateRoomSettings(roomId, socket.id, payload?.settings || {});
      if (!updated.ok) {
        if (updated.reason === "NOT_OWNER") {
          socket.emit("room_error", { message: "Only room admin can edit settings." });
        } else if (updated.reason === "SETTINGS_LOCKED") {
          socket.emit("room_error", { message: "Settings are locked after game start." });
        } else {
          socket.emit("room_error", { message: "Unable to update room settings." });
        }
        return;
      }

      io.to(roomId).emit("room_settings_updated", {
        settings: updated.settings,
        updatedBy: getPlayerName(roomId, socket.id),
        resetStartReady: updated.resetStartReady
      });

      emitRoomState(io, roomId);
      emitLobbyStartStatus(io, roomId);
    });

    socket.on("start_game", (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      const ready = markReadyToStart(roomId, socket.id);
      if (!ready.ok) {
        if (ready.reason === "WAITING_FOR_PLAYERS") {
          socket.emit("room_error", { message: "Need 2 players before start." });
        } else if (ready.reason === "LOBBY_NOT_ACTIVE") {
          socket.emit("room_error", { message: "Match already started." });
        } else {
          socket.emit("room_error", { message: "Cannot mark ready right now." });
        }
        return;
      }

      emitLobbyStartStatus(io, roomId);
      emitRoomState(io, roomId);

      if (!allPlayersReadyToStart(roomId)) return;

      startTeamSelection(roomId);

      io.to(roomId).emit("game_started", {
        message: "Both players pressed start. Round started.",
        round: getRoundInfo(roomId),
        settings: getRoomSettings(roomId)
      });

      emitRoomState(io, roomId);
      emitTeamSelectionProgress(io, roomId);
      startTeamSelectionTimer(io, roomId);
    });

    socket.on("leave_room", (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      handleLeaveRoom(roomId, {
        emitToSocket: true,
        removeSocketFromChannel: true
      });
    });

    socket.on("select_team", (payload) => {
      const roomId = extractRoomId(payload);
      const team = normalizeTeam(payload?.team);

      if (!roomId || !team) {
        socket.emit("team_error", { message: "Select a valid team." });
        return;
      }

      const result = setTeam(roomId, socket.id, team);
      if (!result.ok) {
        if (result.reason === "TEAM_SELECTION_NOT_ACTIVE") {
          socket.emit("team_error", { message: "Team selection is not active right now." });
        } else {
          socket.emit("team_error", { message: "Unable to select this team." });
        }
        return;
      }

      emitRoomState(io, roomId);
      emitTeamSelectionProgress(io, roomId);

      if (result.ready) {
        clearTeamSelectionTimer(roomId);

        const teams = getTeams(roomId);
        if (!teams) return;

        if (teams.teamA === teams.teamB) {
          const retrySeconds = 4;
          startTeamSelection(roomId);

          io.to(roomId).emit("same_team_selected", {
            team: teams.teamA,
            retrySeconds,
            message: "Both players selected same team (" + teams.teamA + "). Choose again in " + retrySeconds + "s."
          });

          emitRoomState(io, roomId);
          startSameTeamRetryWindow(io, roomId, retrySeconds);
          return;
        }

        io.to(roomId).emit("both_teams_selected", {
          ...teams,
          round: getRoundInfo(roomId)
        });

        io.to(roomId).emit("round_started", {
          round: getRoundInfo(roomId),
          answerSeconds: getRoomSettings(roomId)?.answerSeconds || 50
        });

        startAnswerTimer(io, roomId);
      }
    });

    socket.on("submit_answer", (payload) => {
      const roomId = extractRoomId(payload);
      const playerName = normalizePlayerName(payload?.playerName);

      if (!roomId || !playerName) return;
      if (!canSubmitAnswer(roomId)) return;

      const teams = getTeams(roomId);
      if (!teams) return;

      const senderName = getPlayerName(roomId, socket.id);
      io.to(roomId).emit("answer_submitted", {
        senderId: socket.id,
        senderName,
        playerName,
        at: Date.now()
      });

      const result = validateAnswer({
        teamA: teams.teamA,
        teamB: teams.teamB,
        playerName
      });

      const alreadyUsed = isAnswerUsedForMatchup(roomId, teams.teamA, teams.teamB, playerName);
      const isInvalidAnswer = !result.valid || alreadyUsed;

      if (isInvalidAnswer) {
        const settings = getRoomSettings(roomId);

        if (alreadyUsed) {
          socket.emit("room_error", {
            message: `${playerName} already used for ${teams.teamA} vs ${teams.teamB}. Try another player.`
          });
        }

        if (settings?.negativeMarking && settings.wrongAnswerPenalty > 0) {
          addScore(roomId, socket.id, -settings.wrongAnswerPenalty);

          io.to(roomId).emit("answer_penalty", {
            playerId: socket.id,
            playerName: senderName,
            guess: playerName,
            penalty: settings.wrongAnswerPenalty,
            reason: alreadyUsed ? "already_used" : "invalid_player",
            scores: getScores(roomId)
          });

          emitRoomState(io, roomId);
        }

        return;
      }

      const settings = getRoomSettings(roomId) || { answerSeconds: 50 };
      const secondsLeft = getAnswerSecondsLeft(roomId);
      const scoreDelta = calculateSpeedScore(settings.answerSeconds, secondsLeft);

      clearAnswerTimer(roomId);

      const roundResult = finishRound(roomId, {
        winnerId: socket.id,
        answer: playerName,
        reason: "winner",
        scoreDelta
      });

      if (!roundResult) return;

      markAnswerUsedForMatchup(roomId, teams.teamA, teams.teamB, playerName);

      io.to(roomId).emit("round_winner", {
        winner: socket.id,
        winnerName: senderName,
        answer: playerName,
        reason: "winner",
        scoreDelta,
        scores: getScores(roomId),
        round: getRoundInfo(roomId)
      });

      if (maybeCompleteMatchAfterRound(io, roomId, "winner")) {
        return;
      }

      emitRoomState(io, roomId);
      emitNextRoundStatus(io, roomId);
    });

    socket.on("forfeit_match", (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      if (getRoomPhase(roomId) === "game_over") {
        socket.emit("room_error", { message: "Match already ended." });
        return;
      }

      const forfeiterName = getPlayerName(roomId, socket.id);
      const winnerId = getOpponentId(roomId, socket.id);

      clearAllTimers(roomId);
      setGameOver(roomId);

      const scores = getScores(roomId);
      const winnerName = winnerId ? getPlayerName(roomId, winnerId) : null;

      io.to(roomId).emit("game_over", {
        message: winnerName
          ? `${forfeiterName} forfeited the match. ${winnerName} wins.`
          : `${forfeiterName} forfeited the match.`,
        round: getRoundInfo(roomId),
        scores,
        winnerId: winnerId || null,
        winnerName
      });

      emitRoomState(io, roomId);
    });

    socket.on("rematch", (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      const ready = markReadyForRematch(roomId, socket.id);
      if (!ready.ok) {
        if (ready.reason === "GAME_NOT_OVER") {
          socket.emit("room_error", { message: "Rematch is available only after match over." });
        } else if (ready.reason === "WAITING_FOR_PLAYERS") {
          socket.emit("room_error", { message: "Need 2 players in room for rematch." });
        } else {
          socket.emit("room_error", { message: "You are not in this room." });
        }
        return;
      }

      emitRematchStatus(io, roomId);
      emitRoomState(io, roomId);

      if (!allPlayersReadyForRematch(roomId)) return;

      clearAllTimers(roomId);

      const resetOk = resetMatch(roomId);
      if (!resetOk) {
        socket.emit("room_error", { message: "Unable to start rematch." });
        return;
      }

      io.to(roomId).emit("rematch_started", {
        message: "Rematch ready. Press Start when both players are ready.",
        round: getRoundInfo(roomId),
        settings: getRoomSettings(roomId)
      });

      emitRoomState(io, roomId);
      emitLobbyStartStatus(io, roomId);
    });

    socket.on("forfeit_round", () => {
      socket.emit("room_error", { message: "Round forfeit is disabled. Use Forfeit Match." });
    });

    socket.on("next_round", (payload) => {
      const roomId = extractRoomId(payload);
      if (!roomId) return;

      const ready = markReadyForNextRound(roomId, socket.id);
      if (!ready.ok) {
        socket.emit("room_error", { message: "Cannot move to next round yet." });
        return;
      }

      emitNextRoundStatus(io, roomId);
      emitRoomState(io, roomId);

      if (!allPlayersReady(roomId)) return;

      const advanced = advanceRound(roomId);
      if (!advanced.ok) return;

      if (advanced.gameOver) {
        const scores = getScores(roomId);
        const winner = scores[0] || null;

        io.to(roomId).emit("game_over", {
          message: "Match complete.",
          round: getRoundInfo(roomId),
          scores,
          winnerId: winner?.id || null,
          winnerName: winner?.name || null,
          reason: "post_advance"
        });

        emitRoomState(io, roomId);
        return;
      }

      io.to(roomId).emit("round_reset", {
        message: "Next round started. Select teams.",
        round: getRoundInfo(roomId)
      });

      emitRoomState(io, roomId);
      emitTeamSelectionProgress(io, roomId);
      startTeamSelectionTimer(io, roomId);
    });

    socket.on("disconnecting", () => {
      const joinedRooms = Array.from(socket.rooms).filter((roomId) => roomId !== socket.id);

      joinedRooms.forEach((roomId) => {
        handleLeaveRoom(roomId, {
          emitToSocket: false,
          removeSocketFromChannel: false
        });
      });
    });
  });
}

module.exports = { initSocket };
















