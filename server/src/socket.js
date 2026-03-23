const { Server } = require("socket.io");
const {
  createRoom,
  joinRoom,
  setTeam,
  resetRound,
  markAnswered,
  hasAnswered,
  getTeams,
  removePlayer
} = require("./game/roomManager");
const { validateAnswer } = require("./game/gameLogic");

function initSocket(server) {
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("create_room", (roomId) => {
      createRoom(roomId);
      socket.join(roomId);
      joinRoom(roomId, socket.id);
      socket.emit("room_created", roomId);
    });

    socket.on("join_room", (roomId) => {
      const ok = joinRoom(roomId, socket.id);
      if (!ok) return;

      socket.join(roomId);
      io.to(roomId).emit("player_joined");
    });

    socket.on("select_team", ({ roomId, team }) => {
      const ready = setTeam(roomId, socket.id, team);
      if (ready) {
        io.to(roomId).emit("both_teams_selected", getTeams(roomId));
      }
    });

    socket.on("submit_answer", ({ roomId, playerName }) => {
      if (hasAnswered(roomId)) return;

      const teams = getTeams(roomId);
      if (!teams) return;

      const result = validateAnswer({
        teamA: teams.teamA,
        teamB: teams.teamB,
        playerName
      });

      if (result.valid) {
        markAnswered(roomId);
        io.to(roomId).emit("round_winner", {
          winner: socket.id,
          answer: result.playerName
        });
      }
    });

    socket.on("next_round", (roomId) => {
      resetRound(roomId);
      io.to(roomId).emit("round_reset");
    });

    socket.on("disconnect", () => {
      for (const roomId of socket.rooms) {
        removePlayer(roomId, socket.id);
        io.to(roomId).emit("player_left");
      }
    });
  });
}

module.exports = { initSocket };
