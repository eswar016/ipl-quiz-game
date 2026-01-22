const http = require("http");
const app = require("./app");
const { initSocket } = require("./socket");

const server = http.createServer(app);
initSocket(server);

const PORT = 4000;

server.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
