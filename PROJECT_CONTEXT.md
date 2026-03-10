# Project Context: IPL Cross-Team Player Quiz (Real-Time Multiplayer)

## 1) Overview

This is a real-time two-player IPL quiz game.

- Two players join one room.
- Each player selects one IPL team.
- Both players try to submit a cricketer who played for both selected teams.
- The first valid answer wins the round.
- Validation is done on the backend using SQLite team-player history.

Primary learning focus:

- real-time multiplayer systems
- backend game logic and room state
- database-driven answer validation
- full-stack React + Node.js + Socket.IO development

---

## 2) Game Rules

1. Two players join the same room.
2. Each player selects one team.
3. Teams are shown to both players.
4. Players submit player names.
5. Backend validates against database.
6. First correct answer wins.
7. Incorrect answers are ignored.
8. Only first valid answer is accepted.

Example:

- Team A: KKR
- Team B: RCB
- Valid answers: Chris Gayle, Dinesh Karthik, Brendon McCullum

---

## 3) Stack

### Frontend

- React (Vite)
- socket.io-client

### Backend

- Node.js
- Express.js
- Socket.IO

### Database

- SQLite
- better-sqlite3

---

## 4) Data Model

Table:

`team_players(team, player_name)`

Example rows:

- `KKR | Chris Gayle`
- `RCB | Chris Gayle`
- `KKR | Dinesh Karthik`
- `RCB | Dinesh Karthik`
- `CSK | MS Dhoni`

---

## 5) Architecture

React Client  
-> WebSocket  
-> Socket.IO Server  
-> Game Logic + SQLite Validation

Server is source of truth; clients only emit actions and render server events.

---

## 6) Backend Structure

```
server/
  src/
    app.js
    server.js
    socket.js
    db.js
    game/
      validator.js
      gameLogic.js
      roomManager.js
  data/
    ipl-game.db
```

---

## 7) Core Backend Modules

### `db.js`

- Sets up SQLite connection via `better-sqlite3`.
- Executes fast synchronous queries.

### `validator.js`

- Validates whether a player has played for both selected teams.
- Typical query:

```sql
SELECT player_name
FROM team_players
WHERE team IN (?, ?)
  AND LOWER(player_name) = ?
GROUP BY player_name
HAVING COUNT(DISTINCT team) = 2;
```

### `gameLogic.js`

- Wraps validation into reusable game-level functions.
- Input: `teamA`, `teamB`, `playerName`
- Output: `{ valid: true | false }`

### `roomManager.js`

- In-memory room state.
- Tracks players, selected teams, answer lock, round state.
- Prevents same-team selection.
- Enforces max 2 players per room.
- Handles round reset and winner lock.

### `socket.js`

Client -> Server events:

- `create_room`
- `join_room`
- `select_team`
- `submit_answer`
- `next_round`

Server -> Client events:

- `room_created`
- `player_joined`
- `both_teams_selected`
- `round_winner`
- `round_reset`
- `player_left`

---

## 8) Frontend Status

Current UI supports:

- create room
- join room
- select team
- submit answer
- receive live game events

UI is intentionally minimal/testing-oriented right now.

---

## 9) Reliability Features Already Added

- Same-team selection blocked
- Input normalization (case/spacing tolerant)
- First-correct-answer lock
- Player disconnect safety
- Room size limit (2 players)

---

## 10) Current Flow

1. Player A creates room
2. Player B joins room
3. Both select teams
4. Backend locks team pair
5. Players submit answers
6. Backend validates via SQLite
7. First correct answer wins
8. Winner event emitted

---

## 11) Known Limitations

- no score tracking
- no multi-round progression
- no round timer
- basic UI
- no fuzzy matching
- no persistent match history
- no production/mobile deployment yet

---

## 12) Next Steps

- add scoring system
- add multi-round gameplay
- add round timer
- improve answer matching
- improve UI/UX
- add room cleanup and lifecycle management
- deploy backend to Android (Termux)
- expose server via ngrok/Cloudflare tunnel

---

## 13) Learning Goals

- real-time system design
- multiplayer architecture
- backend state management
- DB query-based validation
- WebSocket event design
- deployment basics
