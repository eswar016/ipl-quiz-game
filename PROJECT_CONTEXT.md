# Project Context: IPL Cross-Team Player Quiz (Real-Time Multiplayer)

## 1) Overview

This is a real-time two-player IPL quiz game.

- Two players join one room.
- Room hosts configure match settings (number of rounds, answer time, penalty points).
- Each player selects one IPL team under a strict synchronized timer.
- Both players race against a round timer to submit a cricketer who played for both selected teams.
- Faster valid answers score more points. Incorrect answers can incur penalties.
- The game supports multi-round gameplay, match declaration, and rematch functionality.
- Validation is done securely on the backend using an SQLite team-player history database.

Primary learning focus:
- real-time multiplayer systems
- backend game logic and room state (timers, scoring, match loops, penalties)
- database-driven answer validation and dynamic querying
- full-stack React + Node.js + Socket.IO development

---

## 2) Game Rules & Mechanics

1. **Room Lobby:** Two players join a room. The creator acts as admin and sets round/timer settings. Both click "Ready" to start.
2. **Team Selection:** Players have a timer to pick one team each. Same-team selection triggers a 4-second retry window to avoid deadlocks.
3. **Guessing Phase:** A round timer ticks down. Players submit player names via the chat box.
4. **Validation:** Backend validates against database. Faster answers yield higher speed scores (maximum configurable points degrading to 5). Wrong answers optionally deduct points via negative marking.
5. **Winning:** A player can only win a round once. Used answers are locked for that specific matchup and globally tracked for features.
6. **Multi-Round:** The game naturally proceeds to the next round until the target number of rounds is met.
7. **Rematch:** At game end, players can forfeit or vote for a rematch to replay the same settings.

**Special Feature - "warse" Cheat Code:**
- Typing the keyword `warse` automatically queries the database for a valid crossover player.
- The generated player is globally unique and guaranteed NOT to have been used in any previous round or matchup within the current session.
- The server intercepts this input, hides the keyword, and broadcasts the actual discovered player name to BOTH players, ensuring the opponent never sees the cheat.

---

## 3) Stack

### Frontend
- React (Vite)
- socket.io-client
- Vanilla CSS with beautiful dynamic gradients, glassmorphism, and modern scalable styling.

### Backend
- Node.js
- Express.js
- Socket.IO

### Database
- SQLite
- better-sqlite3

---

## 4) Data Model

Table: `team_players(team, player_name)`

Example Query (Cheat Generator):
```sql
SELECT player_name
FROM team_players
WHERE team IN (?, ?)
  AND LOWER(player_name) NOT IN (?, ?) /* Dynamic exclusions */
GROUP BY player_name
HAVING COUNT(DISTINCT team) = 2
ORDER BY RANDOM() LIMIT 1;
```

---

## 5) Architecture

`React Client -> WebSocket -> Socket.IO Server -> Game Logic + SQLite Validation`

Server is the absolute source of truth. Clients only emit actions (`submit_answer`, `select_team`) and render server events (`room_state`, `answer_submitted`, `round_winner`). Interval timers are executed entirely backend-side with synced pings.

---

## 6) Core Backend Modules

### `db.js`
- Sets up SQLite connection via `better-sqlite3`.

### `validator.js`
- Validates player crossover history. Contains `getRandomValidPlayer(teamA, teamB, excludedPlayers)` for the "warse" cheat code generator with dynamic `NOT IN` clauses.

### `gameLogic.js`
- Wraps validation into reusable game-level functions. Handles cheat code (`"warse"`) interception and replacement.

### `roomManager.js`
- In-memory room state tracking (`rooms` map).
- Tracks scores, player connectivity, selected teams, round info, room settings, and globally `usedAnswersByMatchup`.
- Exposes `getAllUsedAnswers(roomId)` to prevent duplicates in cheat evaluations.

### `socket.js`
- Core real-time socket lifecycle.
- Handles intervals and timeouts for Team Selection and Guessing Windows.
- Distributes dynamic scoring and handles penalties.
- Modifies payload injections to ensure opponent never sees internal system data (like raw cheat payloads).

---

## 7) Frontend Status

Current UI supports full game cycle:
- Landing page with room creation/joining forms and setting sliders.
- Lively dynamic Glassmorphism styling.
- Real-time opponent tracking.
- Team selection screen with real-time countdown sync.
- Guessing screen with chat box, round history, scoreboards, and penalty toasts.
- Post-game summary with winner declaration and rematch polling.

---

## 8) Completed Features (vs Original Scope)

- **Completed:** Fully styled UI/UX.
- **Completed:** Score tracking with speed-based points integration.
- **Completed:** Multi-round progression & configurable settings.
- **Completed:** Round & selection timers running reliably on the server.
- **Completed:** Automatic "warse" intelligence (Global duplication blocking + Chat message spoofing).
- **Completed:** Same-team retry window limits.
- **Completed:** Disconnect handling and Forfeit logic.

---

## 9) Known Limitations

- basic UI (mobile responsiveness could be improved depending on the device)
- no persistent match history / global leaderboards across server restarts
- no fuzzy matching algorithm (relies on exact name or exact case normalization; the "warse" cheat bridges this exact-name limitation for testing users)

---

## 10) Next Steps

- add persistent player accounts and leaderboards
- add fuzzy matching for common player names (e.g. MS Dhoni vs Mahendra Singh Dhoni)
- deploy database into a fully remote storage bucket or transition to Postgres for serverless deployments
