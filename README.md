# IPL Cross-Team Player Quiz (Real-Time Multiplayer)

A highly interactive, real-time two-player IPL quiz game built with React, Node.js, Socket.IO, and SQLite.

## Overview

Two players join the same room. The host configures the match settings (rounds, timers, penalties). Each player selects one IPL team, and both players race against a round timer to submit a cricketer who has played for **both** selected teams. The game validates answers securely on the backend against an SQLite database and awards speed-based scores. 

## Features

- **Real-Time Multiplayer:** Hosted via Socket.IO with strict server-authoritative state.
- **Dynamic Scoring & Rules:** Configure round boundaries, answer timers, and wrong-answer penalties. Points degrade based on how fast the answer is submitted.
- **Full Game Loop:** Lobbies, ready checks, team selection with same-team collision avoidance, round loops, and rematch voting.
- **Intelligent Cheat System:** Typing `warse` instantly intercepts on the backend, silently substituting a globally unique, valid crossover player without alerting the opponent.
- **Beautiful UI:** Dynamic glassmorphism layouts and synced real-time countdowns.

## Tech Stack

- **Frontend:** React + Vite + Vanilla CSS
- **Backend:** Node.js + Express.js + Socket.IO
- **Database:** SQLite (`better-sqlite3`)

## Architecture & Data Flow

```text
React Client --> WebSocket --> Socket.IO Server --> Game Logic + SQLite
```
The server controls all intervals, timers, and validations. Clients only emit inputs and subscribe to state changes.

### Core Validation Query
```sql
SELECT player_name FROM team_players 
WHERE team IN (?, ?) AND LOWER(player_name) = ? 
GROUP BY player_name HAVING COUNT(DISTINCT team) = 2;
```

## Local Setup

Requirements:
- Node.js 18+
- npm

1. **Run Backend:**
```bash
cd server
npm install
node src/server.js
```

2. **Run Frontend:**
```bash
cd client
npm install
npm run dev
```

*Frontend connects to `http://localhost:4000` by default. Customize via `VITE_SOCKET_URL` in `.env`.*
