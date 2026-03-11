const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const csvPath = path.resolve(__dirname, "..", "data", "team_players.csv");
const dbPath = path.resolve(__dirname, "..", "data", "ipl-game.db");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === "\"") {
      // Escaped quote inside quoted field.
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

function normalizeTeam(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isHeaderRow(team, playerName) {
  return team.toLowerCase() === "team" && playerName.toLowerCase() === "player_name";
}

function loadRowsFromCsv() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);

  const rows = [];
  const seen = new Set();

  for (const line of lines) {
    if (!line || !line.trim()) continue;

    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;

    const team = normalizeTeam(cols[0]);
    const playerName = normalizePlayerName(cols[1]);

    if (!team || !playerName) continue;
    if (isHeaderRow(team, playerName)) continue;

    const key = `${team}__${playerName.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    rows.push({ team, playerName });
  }

  return rows;
}

function rebuildDb(rows) {
  const db = new Database(dbPath);

  db.exec(`
    DROP TABLE IF EXISTS team_players;
    CREATE TABLE team_players (
      team TEXT NOT NULL,
      player_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_team_players_team ON team_players(team);
    CREATE INDEX IF NOT EXISTS idx_team_players_player_name ON team_players(player_name);
  `);

  const insert = db.prepare("INSERT INTO team_players (team, player_name) VALUES (?, ?)");
  const insertMany = db.transaction((batch) => {
    for (const row of batch) {
      insert.run(row.team, row.playerName);
    }
  });

  insertMany(rows);

  const countRows = db.prepare("SELECT COUNT(*) AS c FROM team_players").get().c;
  const countPlayers = db.prepare("SELECT COUNT(DISTINCT player_name) AS c FROM team_players").get().c;
  const countTeams = db.prepare("SELECT COUNT(DISTINCT team) AS c FROM team_players").get().c;

  db.close();

  return { countRows, countPlayers, countTeams };
}

function main() {
  const rows = loadRowsFromCsv();
  if (!rows.length) {
    throw new Error("No valid rows found in CSV.");
  }

  const stats = rebuildDb(rows);
  console.log(
    JSON.stringify(
      {
        message: "Database rebuilt from CSV.",
        csvPath,
        dbPath,
        insertedRows: stats.countRows,
        distinctPlayers: stats.countPlayers,
        distinctTeams: stats.countTeams
      },
      null,
      2
    )
  );
}

main();

