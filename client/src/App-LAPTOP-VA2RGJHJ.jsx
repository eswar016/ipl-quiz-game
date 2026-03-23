import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:4000");
const TEAM_OPTIONS = ["CSK", "DC", "GT", "KKR", "LSG", "MI", "PBKS", "RCB", "RR", "SRH"];
const PENALTY_OPTIONS = [10, 20, 30, 40];

const DEFAULT_SETTINGS = {
  teamSelectSeconds: 20,
  answerSeconds: 50,
  totalRounds: 5,
  negativeMarking: false,
  wrongAnswerPenalty: 10
};

const toInt = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizePenalty = (value) => {
  const parsed = Number.parseInt(value, 10);
  return PENALTY_OPTIONS.includes(parsed) ? parsed : PENALTY_OPTIONS[0];
};

const mkMsg = (type, text, mine = false) => ({
  id: `${Date.now()}-${Math.random()}`,
  type,
  text,
  mine
});

const toDraftSettings = (settings) => {
  const source = settings || DEFAULT_SETTINGS;
  return {
    teamSelectSeconds: String(source.teamSelectSeconds ?? DEFAULT_SETTINGS.teamSelectSeconds),
    answerSeconds: String(source.answerSeconds ?? DEFAULT_SETTINGS.answerSeconds),
    totalRounds: String(source.totalRounds ?? DEFAULT_SETTINGS.totalRounds),
    negativeMarking: !!source.negativeMarking,
    wrongAnswerPenalty: normalizePenalty(source.wrongAnswerPenalty)
  };
};

const toServerSettings = (draft) => {
  const teamSelectSeconds = toInt(draft.teamSelectSeconds);
  const answerSeconds = toInt(draft.answerSeconds);
  const totalRounds = toInt(draft.totalRounds);

  return {
    teamSelectSeconds: clamp(teamSelectSeconds ?? DEFAULT_SETTINGS.teamSelectSeconds, 1, 999),
    answerSeconds: clamp(answerSeconds ?? DEFAULT_SETTINGS.answerSeconds, 1, 999),
    totalRounds: clamp(totalRounds ?? DEFAULT_SETTINGS.totalRounds, 1, 999),
    negativeMarking: !!draft.negativeMarking,
    wrongAnswerPenalty: normalizePenalty(draft.wrongAnswerPenalty)
  };
};

const phaseLabel = (phase) => String(phase || "lobby").replaceAll("_", " ");
const penaltyLabel = (settings) =>
  settings?.negativeMarking ? `-${normalizePenalty(settings?.wrongAnswerPenalty)}` : "-";

function App() {
  const [roomIdInput, setRoomIdInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [team, setTeam] = useState(TEAM_OPTIONS[0]);
  const [answer, setAnswer] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(toDraftSettings(DEFAULT_SETTINGS));

  const [isConnected, setIsConnected] = useState(socket.connected);
  const [joinedRoomId, setJoinedRoomId] = useState("");
  const [status, setStatus] = useState("Create or join a room to begin.");
  const [setupMessage, setSetupMessage] = useState("");

  const [roomState, setRoomState] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [teamSecondsLeft, setTeamSecondsLeft] = useState(null);
  const [guessSecondsLeft, setGuessSecondsLeft] = useState(null);

  const [lobbyReadyIds, setLobbyReadyIds] = useState([]);
  const [lobbyWaitingFor, setLobbyWaitingFor] = useState([]);
  const [nextRoundReadyIds, setNextRoundReadyIds] = useState([]);
  const [nextRoundWaitingFor, setNextRoundWaitingFor] = useState([]);
  const [rematchReadyIds, setRematchReadyIds] = useState([]);
  const [rematchWaitingFor, setRematchWaitingFor] = useState([]);
  const [sameTeamPopup, setSameTeamPopup] = useState({
    visible: false,
    team: "",
    secondsLeft: 0
  });

  const [selectedMyTeam, setSelectedMyTeam] = useState("");
  const [finalWinnerId, setFinalWinnerId] = useState(null);

  const [winnerPopup, setWinnerPopup] = useState({
    visible: false,
    title: "",
    subtitle: "",
    sticky: false,
    finale: false
  });

  const winnerPopupTimerRef = useRef(null);
  const chatWindowRef = useRef(null);
  const joinedRoomIdRef = useRef("");

  const isInRoom = Boolean(joinedRoomId);
  const phase = roomState?.phase || "lobby";
  const isOwner = roomState?.ownerId === socket.id;
  const canEditLobbySettings = isInRoom && isOwner && phase === "lobby";
  const roundCurrent = roomState?.round?.current || 1;
  const roundTotal = roomState?.round?.total || Number.parseInt(settingsDraft.totalRounds, 10) || 1;

  const teamSelectionMap = useMemo(() => {
    const map = new Map();
    (roomState?.teamSelections || []).forEach((entry) => {
      map.set(entry.playerId, entry.team);
    });
    return map;
  }, [roomState]);

  const clearWinnerPopupTimer = useCallback(() => {
    if (winnerPopupTimerRef.current) {
      clearTimeout(winnerPopupTimerRef.current);
      winnerPopupTimerRef.current = null;
    }
  }, []);

  const showWinnerPopup = useCallback(
    (title, subtitle, options = {}) => {
      clearWinnerPopupTimer();
      const sticky = !!options.sticky;
      const finale = !!options.finale;

      setWinnerPopup({ visible: true, title, subtitle: subtitle || "", sticky, finale });

      if (!sticky) {
        winnerPopupTimerRef.current = setTimeout(() => {
          setWinnerPopup((prev) => ({ ...prev, visible: false }));
        }, 3200);
      }
    },
    [clearWinnerPopupTimer]
  );

  const clearLocalRoomState = useCallback(() => {
    setJoinedRoomId("");
    setRoomState(null);
    setChatMessages([]);
    setTeamSecondsLeft(null);
    setGuessSecondsLeft(null);
    setLobbyReadyIds([]);
    setLobbyWaitingFor([]);
    setNextRoundReadyIds([]);
    setNextRoundWaitingFor([]);
    setRematchReadyIds([]);
    setRematchWaitingFor([]);
    setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
    setSelectedMyTeam("");
    setAnswer("");
    setFinalWinnerId(null);
    setSettingsDraft(toDraftSettings(DEFAULT_SETTINGS));
  }, []);

  const emitSettingsPatch = useCallback(
    (patch) => {
      if (!joinedRoomId || !isOwner || phase !== "lobby") return;
      socket.emit("update_room_settings", { roomId: joinedRoomId, settings: patch });
    },
    [joinedRoomId, isOwner, phase]
  );

  useEffect(() => {
    joinedRoomIdRef.current = joinedRoomId;
  }, [joinedRoomId]);
  useEffect(() => {
    if (!winnerPopup.visible || !winnerPopup.sticky) return undefined;

    const closeStickyPopup = () => {
      setWinnerPopup((prev) => ({
        ...prev,
        visible: false,
        sticky: false,
        finale: false
      }));
    };

    window.addEventListener("keydown", closeStickyPopup);
    window.addEventListener("pointerdown", closeStickyPopup);

    return () => {
      window.removeEventListener("keydown", closeStickyPopup);
      window.removeEventListener("pointerdown", closeStickyPopup);
    };
  }, [winnerPopup.visible, winnerPopup.sticky]);

  useEffect(() => {
    if (!chatWindowRef.current) return;
    chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    if (!sameTeamPopup.visible) return undefined;

    const intervalId = setInterval(() => {
      setSameTeamPopup((prev) => {
        if (!prev.visible) return prev;

        const nextSeconds = prev.secondsLeft - 1;
        if (nextSeconds <= 0) {
          return { visible: false, team: "", secondsLeft: 0 };
        }

        return { ...prev, secondsLeft: nextSeconds };
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [sameTeamPopup.visible]);

  useEffect(() => {
    const syncConnectionState = () => setIsConnected(socket.connected);
    syncConnectionState();

    const intervalId = setInterval(syncConnectionState, 1200);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => () => clearWinnerPopupTimer(), [clearWinnerPopupTimer]);

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => {
      setIsConnected(false);
      setStatus("Connection lost. Reconnecting...");
    };

    const onRoomCreated = ({ roomId, settings }) => {
      setJoinedRoomId(roomId);
      setStatus(`Room ${roomId} created. You are admin.`);
      setSettingsDraft(toDraftSettings(settings));
      setFinalWinnerId(null);
      setChatMessages([]);
      setSelectedMyTeam("");
      setLobbyReadyIds([]);
      setLobbyWaitingFor([]);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setSetupMessage("");
    };

    const onRoomJoined = ({ roomId, settings }) => {
      setJoinedRoomId(roomId);
      setStatus(`Joined room ${roomId}. Waiting in lobby.`);
      setSettingsDraft(toDraftSettings(settings));
      setFinalWinnerId(null);
      setSelectedMyTeam("");
      setLobbyReadyIds([]);
      setLobbyWaitingFor([]);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setSetupMessage("");
    };

    const onLeftRoom = () => {
      clearLocalRoomState();
      setStatus("You exited the room.");
      setSetupMessage("");
    };

    const onRoomState = (state) => {
      setRoomState(state);
      if (state.ownerId !== socket.id) {
        setSettingsDraft(toDraftSettings(state.settings));
      }

      const myTeam = state.teamSelections?.find((entry) => entry.playerId === socket.id)?.team || "";
      setSelectedMyTeam(myTeam);

      setLobbyReadyIds(state.startReadyPlayerIds || []);
      if (state.phase !== "round_complete") {
        setNextRoundReadyIds(state.readyPlayerIds || []);
      }

      if (state.phase !== "team_selection") {
        setTeamSecondsLeft(null);
        setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      }
      if (state.phase !== "guessing") setGuessSecondsLeft(null);
    };

    const onPlayerJoined = ({ playerCount }) => {
      setStatus(
        playerCount < 2
          ? "Waiting for another player to join."
          : "Both players joined. Press Start when ready."
      );
    };

    const onPlayerLeft = (payload) => {
      setStatus(payload?.message || "A player left the room.");
      setTeamSecondsLeft(null);
      setGuessSecondsLeft(null);
      setSelectedMyTeam("");
      setLobbyReadyIds([]);
      setLobbyWaitingFor([]);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setRematchReadyIds([]);
      setRematchWaitingFor([]);
      setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      setSetupMessage("");
      setChatMessages((prev) => [...prev, mkMsg("system", payload?.message || "A player left the room.")]);
    };

    const onRoomSettingsUpdated = ({ updatedBy, resetStartReady, settings }) => {
      setStatus(
        resetStartReady
          ? `${updatedBy} updated rules. Start readiness reset.`
          : `${updatedBy} updated room rules.`
      );
      if (settings) setSettingsDraft(toDraftSettings(settings));
    };

    const onLobbyStartStatus = ({ readyPlayerIds, waitingFor, readyPlayers, canStart }) => {
      setLobbyReadyIds(readyPlayerIds || []);
      setLobbyWaitingFor(waitingFor || []);

      if (!canStart) {
        setStatus("Waiting for second player to join.");
        return;
      }

      if (waitingFor?.length) {
        setStatus(`Ready: ${readyPlayers.join(", ")}. Waiting for: ${waitingFor.join(", ")}.`);
      }
    };

    const onGameStarted = ({ message }) => {
      setStatus(message || "Game started. Select teams.");
      setChatMessages([mkMsg("system", "Round started. Pick teams and begin guessing.")]);
    };

    const onTeamSelectionProgress = ({ selectedCount, playerCount }) => {
      if (playerCount < 2) {
        setStatus("Waiting for another player to join.");
        return;
      }

      if (selectedCount === 0) setStatus("Select your team before timer ends.");
      if (selectedCount === 1) setStatus("One team selected. Waiting for other player...");
    };

    const onTeamSelectionTimer = ({ secondsLeft }) => setTeamSecondsLeft(secondsLeft);

    const onBothTeamsSelected = ({ teamA, teamB, round }) => {
      setStatus("Round " + (round?.current ?? "-") + "/" + (round?.total ?? "-") + ": " + teamA + " vs " + teamB);
      setTeamSecondsLeft(null);
      setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      setChatMessages([mkMsg("system", "Round started: " + teamA + " vs " + teamB + ". Submit guesses in chat.")]);
    };

    const onSameTeamSelected = ({ message, retrySeconds, team }) => {
      const parsed = Number(retrySeconds);
      const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
      const text = message || ("Both players selected same team (" + (team || "-") + "). Choose again in " + seconds + "s.");

      setSelectedMyTeam("");
      setTeamSecondsLeft(null);
      setGuessSecondsLeft(null);
      setSameTeamPopup({
        visible: true,
        team: team || "",
        secondsLeft: seconds
      });
      setStatus(text);
      setChatMessages((prev) => [...prev, mkMsg("system", text)]);
    };

    const onSameTeamRetryComplete = ({ message }) => {
      setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      if (message) setStatus(message);
    };

    const onRoundStarted = ({ answerSeconds }) => setGuessSecondsLeft(answerSeconds);
    const onRoundTimer = ({ secondsLeft }) => setGuessSecondsLeft(secondsLeft);

    const onAnswerSubmitted = ({ senderId, senderName, playerName }) => {
      const mine = senderId === socket.id;
      const sender = mine ? "You" : senderName;
      setChatMessages((prev) => [...prev, mkMsg("guess", `${sender}: ${playerName}`, mine)]);
    };

    const onAnswerPenalty = ({ playerName, penalty, guess }) => {
      setStatus(`${playerName} guessed "${guess}". Penalty applied: -${penalty}.`);
      setChatMessages((prev) => [...prev, mkMsg("system", `${playerName} guessed wrong. -${penalty} points.`)]);
    };

    const onRoundWinner = ({ winner, winnerName, answer: winningAnswer, scoreDelta, round }) => {
      setStatus(`${winnerName} won Round ${round?.current}/${round?.total} with "${winningAnswer}".`);
      setGuessSecondsLeft(null);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setSetupMessage("");
      setChatMessages((prev) => [
        ...prev,
        mkMsg("system", `${winnerName} won with "${winningAnswer}" (+${scoreDelta || 0} points).`)
      ]);

      const isMine = winner === socket.id;
      showWinnerPopup(
        isMine ? "Round Won" : `${winnerName} Won`,
        `${winningAnswer} | +${scoreDelta || 0} points`
      );
    };

    const onRoundTimeout = ({ message }) => {
      setStatus(message || "Round timed out.");
      setGuessSecondsLeft(null);
      setChatMessages((prev) => [...prev, mkMsg("system", message || "Round timed out. No winner.")]);
    };

    const onTeamSelectionTimeout = ({ message }) => {
      setStatus(message || "Team selection timeout.");
      setTeamSecondsLeft(null);
    };

    const onNextRoundStatus = ({ readyPlayerIds, waitingFor, readyPlayers }) => {
      setNextRoundReadyIds(readyPlayerIds || []);
      setNextRoundWaitingFor(waitingFor || []);
      if (waitingFor?.length) {
        setStatus(`Next round ready: ${readyPlayers.join(", ")}. Waiting for: ${waitingFor.join(", ")}.`);
      }
    };

    const onRoundReset = ({ message, round }) => {
      setStatus(message || `Round ${round?.current}/${round?.total} started.`);
      setSelectedMyTeam("");
      setAnswer("");
      setTeamSecondsLeft(null);
      setGuessSecondsLeft(null);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setRematchReadyIds([]);
      setRematchWaitingFor([]);
      setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      setSetupMessage("");
      setChatMessages((prev) => [...prev, mkMsg("system", message || "Next round started. Select teams.")]);
    };

    const onRematchStatus = ({ readyPlayerIds, waitingFor, readyPlayers }) => {
      setRematchReadyIds(readyPlayerIds || []);
      setRematchWaitingFor(waitingFor || []);

      if (waitingFor?.length) {
        setStatus(`Rematch ready: ${readyPlayers.join(", ")}. Waiting for: ${waitingFor.join(", ")}.`);
      }
    };

    const onRematchStarted = ({ message }) => {
      clearWinnerPopupTimer();
      setWinnerPopup((prev) => ({ ...prev, visible: false, sticky: false, finale: false }));
      setStatus(message || "Rematch ready. Press Start when both players are ready.");
      setFinalWinnerId(null);
      setSelectedMyTeam("");
      setAnswer("");
      setTeamSecondsLeft(null);
      setGuessSecondsLeft(null);
      setLobbyReadyIds([]);
      setLobbyWaitingFor([]);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setRematchReadyIds([]);
      setRematchWaitingFor([]);
      setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      setSetupMessage("");
      setChatMessages([mkMsg("system", message || "Rematch ready. Press Start when both players are ready.")]);
    };

    const onGameOver = ({ message, winnerId, winnerName }) => {
      setFinalWinnerId(winnerId || null);
      setStatus(message || "Match complete.");
      setTeamSecondsLeft(null);
      setGuessSecondsLeft(null);
      setNextRoundReadyIds([]);
      setNextRoundWaitingFor([]);
      setRematchReadyIds([]);
      setRematchWaitingFor([]);
      setSameTeamPopup({ visible: false, team: "", secondsLeft: 0 });
      setSetupMessage("");

      if (winnerName) {
        showWinnerPopup(`${winnerName} Wins The Match`, "Press any key to close", {
          sticky: true,
          finale: true
        });
      } else {
        showWinnerPopup("Match Over", "No winner for this match", {
          sticky: true,
          finale: true
        });
      }
    };

    const onRoomError = (payload) => {
      const message = payload?.message || "Room action failed.";
      setStatus(message);

      const context = payload?.context || "";
      if (context === "create_room" || context === "join_room" || !joinedRoomIdRef.current) {
        setSetupMessage(message);
      }
    };
    const onTeamError = (payload) => setStatus(payload?.message || "Team selection failed.");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_created", onRoomCreated);
    socket.on("room_joined", onRoomJoined);
    socket.on("left_room", onLeftRoom);
    socket.on("room_state", onRoomState);
    socket.on("player_joined", onPlayerJoined);
    socket.on("player_left", onPlayerLeft);
    socket.on("room_settings_updated", onRoomSettingsUpdated);
    socket.on("lobby_start_status", onLobbyStartStatus);
    socket.on("game_started", onGameStarted);
    socket.on("team_selection_progress", onTeamSelectionProgress);
    socket.on("team_selection_timer", onTeamSelectionTimer);
    socket.on("team_selection_timeout", onTeamSelectionTimeout);
    socket.on("same_team_selected", onSameTeamSelected);
    socket.on("same_team_retry_complete", onSameTeamRetryComplete);
    socket.on("both_teams_selected", onBothTeamsSelected);
    socket.on("round_started", onRoundStarted);
    socket.on("round_timer", onRoundTimer);
    socket.on("answer_submitted", onAnswerSubmitted);
    socket.on("answer_penalty", onAnswerPenalty);
    socket.on("round_winner", onRoundWinner);
    socket.on("round_timeout", onRoundTimeout);
    socket.on("next_round_status", onNextRoundStatus);
    socket.on("round_reset", onRoundReset);
    socket.on("rematch_status", onRematchStatus);
    socket.on("rematch_started", onRematchStarted);
    socket.on("game_over", onGameOver);
    socket.on("room_error", onRoomError);
    socket.on("team_error", onTeamError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_created", onRoomCreated);
      socket.off("room_joined", onRoomJoined);
      socket.off("left_room", onLeftRoom);
      socket.off("room_state", onRoomState);
      socket.off("player_joined", onPlayerJoined);
      socket.off("player_left", onPlayerLeft);
      socket.off("room_settings_updated", onRoomSettingsUpdated);
      socket.off("lobby_start_status", onLobbyStartStatus);
      socket.off("game_started", onGameStarted);
      socket.off("team_selection_progress", onTeamSelectionProgress);
      socket.off("team_selection_timer", onTeamSelectionTimer);
      socket.off("team_selection_timeout", onTeamSelectionTimeout);
      socket.off("same_team_selected", onSameTeamSelected);
      socket.off("same_team_retry_complete", onSameTeamRetryComplete);
      socket.off("both_teams_selected", onBothTeamsSelected);
      socket.off("round_started", onRoundStarted);
      socket.off("round_timer", onRoundTimer);
      socket.off("answer_submitted", onAnswerSubmitted);
      socket.off("answer_penalty", onAnswerPenalty);
      socket.off("round_winner", onRoundWinner);
      socket.off("round_timeout", onRoundTimeout);
      socket.off("next_round_status", onNextRoundStatus);
      socket.off("round_reset", onRoundReset);
      socket.off("rematch_status", onRematchStatus);
      socket.off("rematch_started", onRematchStarted);
      socket.off("game_over", onGameOver);
      socket.off("room_error", onRoomError);
      socket.off("team_error", onTeamError);
    };
  }, [clearLocalRoomState, showWinnerPopup, clearWinnerPopupTimer]);

  const handleDraftNumberChange = (fieldName) => (event) => {
    const raw = event.target.value;
    if (!/^\d{0,3}$/.test(raw)) return;

    setSettingsDraft((prev) => ({ ...prev, [fieldName]: raw }));

    const parsed = toInt(raw);
    if (parsed !== null && parsed >= 1 && parsed <= 999) {
      emitSettingsPatch({ [fieldName]: parsed });
    }
  };

  const handleNegativeToggle = (event) => {
    const checked = event.target.checked;
    setSettingsDraft((prev) => ({ ...prev, negativeMarking: checked }));
    emitSettingsPatch({ negativeMarking: checked });
  };

  const handlePenaltyChange = (event) => {
    const nextPenalty = normalizePenalty(event.target.value);
    setSettingsDraft((prev) => ({ ...prev, wrongAnswerPenalty: nextPenalty }));
    emitSettingsPatch({ wrongAnswerPenalty: nextPenalty });
  };

  const createRoom = () => {
    const roomId = roomIdInput.trim();
    const username = usernameInput.trim();
    if (!roomId || !username) {
      const message = "Enter your name and room ID.";
      setStatus(message);
      setSetupMessage(message);
      return;
    }

    setSetupMessage("");
    socket.emit("create_room", {
      roomId,
      username,
      settings: toServerSettings(settingsDraft)
    });
  };

  const joinRoom = () => {
    const roomId = roomIdInput.trim();
    const username = usernameInput.trim();
    if (!roomId || !username) {
      const message = "Enter your name and room ID.";
      setStatus(message);
      setSetupMessage(message);
      return;
    }

    setSetupMessage("");
    socket.emit("join_room", { roomId, username });
  };

  const startGame = () => {
    if (!joinedRoomId) return;
    socket.emit("start_game", { roomId: joinedRoomId });
  };

  const selectTeam = () => {
    if (!joinedRoomId || !team) return;
    setSelectedMyTeam(team);
    socket.emit("select_team", { roomId: joinedRoomId, team });
  };

  const submitAnswer = () => {
    const playerName = answer.trim();
    if (!joinedRoomId || !playerName) return;
    socket.emit("submit_answer", { roomId: joinedRoomId, playerName });
    setAnswer("");
  };

  const nextRound = () => {
    if (!joinedRoomId) return;
    socket.emit("next_round", { roomId: joinedRoomId });
  };

  const rematch = () => {
    if (!joinedRoomId) return;
    socket.emit("rematch", { roomId: joinedRoomId });
  };

  const forfeitMatch = () => {
    if (!joinedRoomId) return;
    socket.emit("forfeit_match", { roomId: joinedRoomId });
  };

  const leaveRoom = () => {
    if (!joinedRoomId) return;
    socket.emit("leave_room", { roomId: joinedRoomId });
  };

  const canStart = phase === "lobby" && (roomState?.playerCount || 0) === 2;
  const myStartReady = lobbyReadyIds.includes(socket.id);
  const myNextRoundReady = nextRoundReadyIds.includes(socket.id);
  const myRematchReady = rematchReadyIds.includes(socket.id);
  const currentTeamSeconds = sameTeamPopup.visible ? sameTeamPopup.secondsLeft : teamSecondsLeft;
  const showAnswerInput = phase === "guessing";
  const showNextRound = phase === "round_complete" && roundCurrent < roundTotal;

  const lobbyLabel = lobbyWaitingFor.length
    ? `Waiting for: ${lobbyWaitingFor.join(", ")}`
    : "Both players can press Start.";

  const nextRoundLabel = nextRoundWaitingFor.length
    ? `Waiting for: ${nextRoundWaitingFor.join(", ")}`
    : "Both players are ready.";

  const rematchLabel = rematchWaitingFor.length
    ? `Waiting for: ${rematchWaitingFor.join(", ")}`
    : "Both players accepted rematch.";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>IPL Cross-Team Quiz</h1>
          <p>Real-time multiplayer player-history challenge</p>
        </div>

        <div className="header-right">
          <span className="room-chip">Room: {joinedRoomId || "-"}</span>
          <span className={`connection-pill ${isConnected ? "online" : "offline"}`}>
            {isConnected ? "Live" : "Reconnecting"}
          </span>

          {roomState && (
            <div className="room-snapshot-dock">
              <button type="button" className="snapshot-trigger">Room Snapshot</button>
              <div className="room-snapshot-panel" role="group" aria-label="Room Snapshot">
                <p><span>Admin:</span> {roomState.ownerName || "-"}</p>
                <p><span>Round:</span> {roundCurrent}/{roundTotal}</p>
                <p><span>Phase:</span> {phaseLabel(phase)}</p>
                <p><span>Players:</span> {roomState.playerCount || 0}/2</p>
                <p><span>Your Team:</span> {selectedMyTeam || "Not selected"}</p>
                <p><span>Team Timer:</span> {roomState.settings?.teamSelectSeconds || DEFAULT_SETTINGS.teamSelectSeconds}s</p>
                <p><span>Guess Timer:</span> {roomState.settings?.answerSeconds || DEFAULT_SETTINGS.answerSeconds}s</p>
                <p><span>Negative:</span> {roomState.settings?.negativeMarking ? "On" : "Off"}</p>
                <p><span>Penalty:</span> {penaltyLabel(roomState.settings)}</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="layout-grid">
        <section className="panel">
          <h2>{isOwner ? "Admin Lobby" : "Room Panel"}</h2>

          {roomState ? (
            <>
              <div className="players-list">
                {(roomState.players || []).map((player) => (
                  <div key={player.id} className="player-row">
                    <span>
                      {player.name}
                      {player.id === roomState.ownerId ? " (Admin)" : ""}
                      {player.id === socket.id ? " (You)" : ""}
                    </span>
                    <small>{teamSelectionMap.get(player.id) || "No team"}</small>
                  </div>
                ))}
              </div>

              {phase === "lobby" && (
                <div className="compact-room-rules">
                  {isOwner ? (
                    <>
                      <h3 className="sub-title">Admin Lobby</h3>
                      <div className="lobby-admin-grid">
                        <label className="setup-field compact">
                          <span>Team Timer</span>
                          <input
                            inputMode="numeric"
                            maxLength={3}
                            value={settingsDraft.teamSelectSeconds}
                            onChange={handleDraftNumberChange("teamSelectSeconds")}
                            disabled={!canEditLobbySettings}
                            placeholder="20"
                          />
                        </label>

                        <label className="setup-field compact">
                          <span>Guess Timer</span>
                          <input
                            inputMode="numeric"
                            maxLength={3}
                            value={settingsDraft.answerSeconds}
                            onChange={handleDraftNumberChange("answerSeconds")}
                            disabled={!canEditLobbySettings}
                            placeholder="50"
                          />
                        </label>

                        <label className="setup-field compact">
                          <span>Total Rounds</span>
                          <input
                            inputMode="numeric"
                            maxLength={3}
                            value={settingsDraft.totalRounds}
                            onChange={handleDraftNumberChange("totalRounds")}
                            disabled={!canEditLobbySettings}
                            placeholder="5"
                          />
                        </label>

                        <label className={`negative-toggle ${settingsDraft.negativeMarking ? "enabled" : ""}`}>
                          <input
                            type="checkbox"
                            checked={settingsDraft.negativeMarking}
                            onChange={handleNegativeToggle}
                            disabled={!canEditLobbySettings}
                          />
                          <span className="switch-track"><span className="switch-thumb" /></span>
                          <span className="toggle-label">Enable Negative Marking</span>
                        </label>

                        {settingsDraft.negativeMarking && (
                          <label className="setup-field compact penalty-field">
                            <span>Wrong Guess Penalty</span>
                            <select
                              className="settings-select"
                              value={settingsDraft.wrongAnswerPenalty}
                              onChange={handlePenaltyChange}
                              disabled={!canEditLobbySettings}
                            >
                              {PENALTY_OPTIONS.map((option) => (
                                <option key={option} value={option}>-{option}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="info-card">
                      <p><span>Team Timer:</span> {roomState.settings?.teamSelectSeconds}s</p>
                      <p><span>Guess Timer:</span> {roomState.settings?.answerSeconds}s</p>
                      <p><span>Total Rounds:</span> {roomState.settings?.totalRounds}</p>
                      <p><span>Negative:</span> {roomState.settings?.negativeMarking ? "On" : "Off"}</p>
                      <p><span>Penalty:</span> {penaltyLabel(roomState.settings)}</p>
                    </div>
                  )}
                </div>
              )}

              {phase === "lobby" && (
                <div className="start-zone">
                  <button
                    type="button"
                    className="btn primary large"
                    onClick={startGame}
                    disabled={!canStart || myStartReady}
                  >
                    {myStartReady ? "Ready Sent" : "Start Match"}
                  </button>
                  <p>{lobbyLabel}</p>
                </div>
              )}

              {roomState.selectedTeams && (
                <div className="matchup-card">
                  <p className="matchup-title">Current Matchup</p>
                  <h3>
                    <span>{roomState.selectedTeams.teamA}</span> vs <span>{roomState.selectedTeams.teamB}</span>
                  </h3>
                </div>
              )}
            </>
          ) : (
            <p className="muted">Join a room to view players and controls.</p>
          )}

          <div className="button-stack">
            <button type="button" className="btn ghost" onClick={leaveRoom} disabled={!isInRoom}>Exit Room</button>
            <button
              type="button"
              className="btn danger"
              onClick={forfeitMatch}
              disabled={!isInRoom || phase === "lobby" || phase === "game_over"}
            >
              Forfeit Match
            </button>
          </div>

          <div className="status-bar"><p>{status}</p></div>
        </section>

        <section className="panel">
          <div className="round-meta">
            <div>
              <p className="meta-label">Round</p>
              <p className="timer">{roundCurrent}/{roundTotal}</p>
            </div>
            <div>
              <p className="meta-label">Timer</p>
              <p className={`timer ${((phase === "team_selection" && currentTeamSeconds !== null && currentTeamSeconds <= 5) || (phase === "guessing" && guessSecondsLeft !== null && guessSecondsLeft <= 10)) ? "danger" : ""}`}>
                {phase === "team_selection"
                  ? `${currentTeamSeconds ?? roomState?.settings?.teamSelectSeconds ?? "-"}s`
                  : phase === "guessing"
                    ? `${guessSecondsLeft ?? roomState?.settings?.answerSeconds ?? "-"}s`
                    : "-"}
              </p>
            </div>
            <div>
              <p className="meta-label">Phase</p>
              <p className="state-pill">{phaseLabel(phase)}</p>
            </div>
          </div>

          <div className="scoreboard-card">
            <p className="meta-label">Total Points</p>
            <div className="scoreboard-list">
              {roomState?.scores?.length ? (
                roomState.scores.map((scoreLine) => {
                  const rowClassName =
                    finalWinnerId && phase === "game_over"
                      ? scoreLine.id === finalWinnerId
                        ? "score-row winner"
                        : "score-row loser"
                      : "score-row";

                  return (
                    <div key={scoreLine.id} className={rowClassName}>
                      <span>{scoreLine.name}{scoreLine.id === socket.id ? " (You)" : ""}</span>
                      <strong>{scoreLine.score}</strong>
                    </div>
                  );
                })
              ) : (
                <p className="score-empty">Scores will appear after gameplay starts.</p>
              )}
            </div>
          </div>

          <div className="chat-window" ref={chatWindowRef}>
            {chatMessages.length ? (
              chatMessages.map((message) => (
                <p key={message.id} className={`chat-message ${message.type}${message.mine ? " mine" : ""}`}>
                  {message.text}
                </p>
              ))
            ) : (
              <p className="chat-empty">Chat guesses and round updates will appear here.</p>
            )}
          </div>

          {showAnswerInput && (
            <div className="answer-row">
              <input
                className="text-input"
                value={answer}
                placeholder="Type player name and submit"
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitAnswer();
                  }
                }}
              />
              <button type="button" className="btn primary" onClick={submitAnswer} disabled={!answer.trim()}>
                Submit Answer
              </button>
            </div>
          )}

          {showNextRound && (
            <div className="next-round-zone">
              <button
                type="button"
                className="btn accent large"
                onClick={nextRound}
                disabled={myNextRoundReady}
              >
                {myNextRoundReady ? "Ready Sent" : "Next Round"}
              </button>
              <p>{nextRoundLabel}</p>
            </div>
          )}

          {phase === "game_over" && (
            <div className="next-round-zone">
              <button
                type="button"
                className="btn accent large"
                onClick={rematch}
                disabled={!isInRoom || myRematchReady}
              >
                {myRematchReady ? "Rematch Requested" : "Rematch"}
              </button>
              <p>{myRematchReady ? rematchLabel : "Match complete. Press Rematch to play again in this room."}</p>
            </div>
          )}
        </section>
      </div>

      {!isInRoom && (
        <div className="overlay">
          <div className="modal-card setup-modal">
            <h2>Room Setup</h2>

            <div className="setup-main-grid">
              <label className="setup-field">
                <span>Your Name</span>
                <input
                  value={usernameInput}
                  onChange={(event) => setUsernameInput(event.target.value)}
                  placeholder="Enter custom username"
                  maxLength={24}
                />
              </label>

              <label className="setup-field">
                <span>Room ID</span>
                <input
                  value={roomIdInput}
                  onChange={(event) => setRoomIdInput(event.target.value)}
                  placeholder="Enter room code"
                  maxLength={16}
                />
              </label>
            </div>



            <div className="button-row">
              <button type="button" className="btn primary" onClick={createRoom}>Create Room</button>
              <button type="button" className="btn ghost" onClick={joinRoom}>Join Room</button>
            </div>

            {setupMessage ? <p className="setup-feedback">{setupMessage}</p> : null}
          </div>
        </div>
      )}

      {isInRoom && phase === "team_selection" && (
        <div className="overlay">
          {sameTeamPopup.visible ? (
            <div className="modal-card same-team-modal">
              <h2>Same Team Selected</h2>
              <p className="same-team-text">
                Both players selected <strong>{sameTeamPopup.team || "the same team"}</strong>
              </p>
              <div className="same-team-countdown">{sameTeamPopup.secondsLeft}s</div>
              <p className="same-team-sub">Choose again when countdown ends.</p>
            </div>
          ) : (
            <div className="modal-card team-modal">
              <h2>Select Team</h2>
              <p className="team-modal-sub">Round {roundCurrent}/{roundTotal}</p>

              {!selectedMyTeam ? (
                <div className="team-picker">
                  <select value={team} onChange={(event) => setTeam(event.target.value)}>
                    {TEAM_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  <button type="button" className="btn primary" onClick={selectTeam}>Lock Team</button>
                </div>
              ) : (
                <div className="wait-card">
                  <span className="dot-loader" />
                  <p>You selected <strong>{selectedMyTeam}</strong>. Waiting for other player to choose.</p>
                </div>
              )}

              <div className="selection-list">
                {(roomState?.players || []).map((player) => (
                  <div key={player.id} className="selection-row">
                    <span>{player.name}</span>
                    <strong>{teamSelectionMap.get(player.id) || "Selecting..."}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {winnerPopup.visible && (
        <div className="winner-toast-wrap" aria-live="polite">
          <div className={`winner-toast ${winnerPopup.finale ? "finale" : ""}`}>
            <h3>{winnerPopup.title}</h3>
            {winnerPopup.subtitle ? <p>{winnerPopup.subtitle}</p> : null}
            {winnerPopup.sticky ? <small>Press any key or click any button to close</small> : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;


