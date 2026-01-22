const rooms = new Map();

function createRoom(roomId) {
  rooms.set(roomId, {
    players: [],
    teams: {},
    answered: false
  });
}

function joinRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return false;

  room.players.push(socketId);
  return true;
}

function setTeam(roomId, socketId, team) {
  const room = rooms.get(roomId);
  if (!room) return false;

  room.teams[socketId] = team;
  return Object.keys(room.teams).length === 2;
}

function markAnswered(roomId) {
  const room = rooms.get(roomId);
  if (room) room.answered = true;
}

function hasAnswered(roomId) {
  const room = rooms.get(roomId);
  return room?.answered;
}

function getTeams(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const players = Object.keys(room.teams);
  return {
    teamA: room.teams[players[0]],
    teamB: room.teams[players[1]]
  };
}

module.exports = {
  createRoom,
  joinRoom,
  setTeam,
  markAnswered,
  hasAnswered,
  getTeams
};
