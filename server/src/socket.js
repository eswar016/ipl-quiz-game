const { Server } = require("socket.io");
const {
  createRoom,
  joinRoom,
  setTeam,
  markAnswered,
  hasAnswered,
  getTeams
} = require("./game/roomManager");
const { validateAnswer } = require("./game/gameLogic");

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.on("create_room", (roomId) => {
      createRoom(roomId);
      socket.join(roomId);
      joinRoom(roomId, socket.id);
      socket.emit("room_created", roomId);
    });

    socket.on("join_room", (roomId) => {
      socket.join(roomId);
      joinRoom(roomId, socket.id);
      io.to(roomId).emit("player_joined", socket.id);
    });

    socket.on("select_team", ({ roomId, team }) => {
      const ready = setTeam(roomId, socket.id, team);
      if (ready) {
        const teams = getTeams(roomId);
        io.to(roomId).emit("both_teams_selected", teams);
      }
    });

    socket.on("submit_answer", ({ roomId, playerName }) => {
      if (hasAnswered(roomId)) return;

      const teams = getTeams(roomId);
      const result = validateAnswer({
        teamA: teams.teamA,
        teamB: teams.teamB,
        playerName
      });

      if (result.valid) {
        markAnswered(roomId);
        io.to(roomId).emit("round_winner", {
          winner: socket.id,
          playerName
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("Player disconnected:", socket.id);
    });
  });
}

module.exports = { initSocket };
