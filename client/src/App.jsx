import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:4000");

function App() {
  const [roomId, setRoomId] = useState("");
  const [team, setTeam] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    socket.on("room_created", (room) => {
      setStatus("Room created: " + room);
    });

    socket.on("player_joined", () => {
      setStatus("Player joined");
    });

    socket.on("both_teams_selected", (teams) => {
      setStatus(`Teams locked: ${teams.teamA} vs ${teams.teamB}`);
    });

    socket.on("round_winner", (data) => {
      setStatus(`Winner! Answer: ${data.playerName}`);
    });

    return () => {
      socket.off();
    };
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>IPL Quiz Game (Test UI)</h2>

      <input
        placeholder="Room ID"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      />

      <br /><br />

      <button onClick={() => socket.emit("create_room", roomId)}>
        Create Room
      </button>

      <button onClick={() => socket.emit("join_room", roomId)}>
        Join Room
      </button>

      <br /><br />

      <input
        placeholder="Team (KKR / RCB / CSK)"
        value={team}
        onChange={(e) => setTeam(e.target.value)}
      />

      <button
        onClick={() =>
          socket.emit("select_team", { roomId, team })
        }
      >
        Select Team
      </button>

      <br /><br />

      <input
        placeholder="Player Name"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />

      <button
        onClick={() =>
          socket.emit("submit_answer", { roomId, playerName: answer })
        }
      >
        Submit Answer
      </button>

      <br /><br />

      <strong>Status:</strong> {status}
    </div>
  );
}

export default App;
