const WebSocket = require("ws");
const server = new WebSocket.Server({ port: 8080 });

console.log("🚀 Signaling Server: ws://localhost:8080");

server.on("connection", (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  ws.id = id;

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "join") {
      ws.userData = { id, name: data.name, avatar: data.avatar };
      broadcastUsers();
    }

    // Relay signaling data (Offer/Answer/Candidate) to specific target
    if (data.target) {
      server.clients.forEach((client) => {
        if (client.id === data.target && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ ...data, from: id, senderName: ws.userData?.name }));
        }
      });
    }
  });

  ws.on("close", () => broadcastUsers());
});

function broadcastUsers() {
  const users = [];
  server.clients.forEach(client => { if (client.userData) users.push(client.userData); });
  const payload = JSON.stringify({ type: "users", users });
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}