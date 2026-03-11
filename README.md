# IPL Cross-Team Player Quiz (Real-Time Multiplayer)

A real-time two-player IPL quiz game built with React, Node.js, Socket.IO, and SQLite.

## Overview

Two players join the same room and each selects one IPL team.  
Both players then race to submit a cricketer who has played for both selected teams.  
The backend validates answers against SQLite data, and the first valid answer wins the round.

Primary learning focus:
- Real-time multiplayer systems
- Backend room-state/game-state management
- Database-driven answer validation
- Full-stack React + Node.js + Socket.IO development

## Game Rules

1. Two players join the same room.
2. Each player selects one team.
3. Both selected teams are shown.
4. Players submit player names.
5. Backend validates each answer.
6. First correct answer wins the round.
7. Incorrect answers are ignored.
8. Only the first valid answer is accepted.

Example:
- Team A: `KKR`
- Team B: `RCB`
- Valid answers: `Chris Gayle`, `Dinesh Karthik`, `Brendon McCullum`

## Tech Stack

Frontend:
- React (Vite)
- `socket.io-client`

Backend:
- Node.js
- Express.js
- Socket.IO

Database:
- SQLite
- `better-sqlite3`

## Architecture

React Client  
-> WebSocket  
-> Socket.IO Server  
-> Game Logic + SQLite Validation

The server is the source of truth. Clients emit actions and render server events.

## Data Model

Table:
- `team_players(team, player_name)`

Typical validation query:

```sql
SELECT player_name
FROM team_players
WHERE team IN (?, ?)
  AND LOWER(player_name) = ?
GROUP BY player_name
HAVING COUNT(DISTINCT team) = 2;
```

## Project Structure

```text
ipl-quiz-game/
  client/
    src/
      App.jsx
      App.css
      index.css
      main.jsx
    index.html
    package.json
    vite.config.js

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
      team_players.csv
    package.json
```

## Core Backend Modules

`db.js`
- Sets up the SQLite connection with `better-sqlite3`.
- Executes synchronous DB queries.

`validator.js`
- Checks whether a player has played for both selected teams.

`gameLogic.js`
- Wraps validation into game-level checks.
- Input: `teamA`, `teamB`, `playerName`
- Output: `{ valid: true | false }`

`roomManager.js`
- In-memory room/game state.
- Tracks players, teams, round state, and answer lock.
- Enforces max 2 players per room.
- Handles round resets.

`socket.js`
- Handles real-time room lifecycle and gameplay events.

Client -> Server events (base flow):
- `create_room`
- `join_room`
- `select_team`
- `submit_answer`
- `next_round`

Server -> Client events (base flow):
- `room_created`
- `player_joined`
- `both_teams_selected`
- `round_winner`
- `round_reset`
- `player_left`

## Current Frontend Scope

- Create room
- Join room
- Select team
- Submit answer
- Receive live game events

## Reliability Features Added

- Same-team selection blocked
- Input normalization (case and spacing tolerance)
- First-correct-answer lock
- Player disconnect handling
- Room size limit (2 players)

## Current Flow

1. Player A creates room.
2. Player B joins room.
3. Both players select teams.
4. Backend locks team pair.
5. Players submit answers.
6. Backend validates via SQLite.
7. First correct answer wins.
8. Winner event is emitted.

## Known Limitations

- No score tracking
- No multi-round progression
- No round timer
- Basic UI
- No fuzzy matching
- No persistent match history
- No production/mobile deployment yet

## Next Steps

- Add scoring system
- Add multi-round gameplay
- Add round timer
- Improve answer matching
- Improve UI/UX
- Add room cleanup and lifecycle management
- Deploy backend to Android (Termux)
- Expose server via ngrok/Cloudflare tunnel

## Learning Goals

- Real-time system design
- Multiplayer architecture
- Backend state management
- DB query-based validation
- WebSocket event design
- Deployment basics

## Local Setup

Requirements:
- Node.js 18+ (recommended)
- npm

Run backend:

```bash
cd server
npm install
node src/server.js
```

Run frontend:

```bash
cd client
npm install
npm run dev
```

Optional frontend environment variable:
- `VITE_SOCKET_URL` (defaults to `http://localhost:4000`)

Health check:
- `GET http://localhost:4000/health`

