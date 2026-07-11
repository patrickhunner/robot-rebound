import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  bidSchema, createRoomSchema, joinRoomSchema, lobbySettingsSchema, moveSchema, placeRobotSchema, roomCommandSchema,
  type CommandResult
} from "@robot-rebound/shared";
import { createRoomCode, GameRoom } from "./room.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.get("/health", (_request, response) => response.json({ ok: true }));
if (process.env.NODE_ENV !== "production") {
  app.get("/", (request, response) => response.redirect(`http://${request.hostname}:5173`));
}
const server = createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const rooms = new Map<string, GameRoom>();
const sessions = new Map<string, { code: string; playerId: string }>();
let lastCreatedBoardId: string | undefined;

function broadcast(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("room:snapshot", room.snapshot(player.id));
  }
}

function run(callback: (result: CommandResult) => void, action: () => CommandResult | void): void {
  try { callback(action() ?? { ok: true }); }
  catch (error) {
    const issues = typeof error === "object" && error !== null && "issues" in error ? (error as { issues?: Array<{ message?: string }> }).issues : undefined;
    callback({ ok: false, error: issues?.[0]?.message ?? (error instanceof Error ? error.message : "Unexpected error") });
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", (raw, callback) => run(callback, () => {
    const input = createRoomSchema.parse(raw);
    const code = createRoomCode(new Set(rooms.keys()));
    const room = new GameRoom(code, input.name, 45, socket.id, broadcast, Math.random, 60, lastCreatedBoardId);
    lastCreatedBoardId = room.board.id;
    rooms.set(code, room);
    const player = room.players[0]!;
    sessions.set(socket.id, { code, playerId: player.id });
    socket.join(code);
    broadcast(code);
    return { ok: true, code, token: player.token };
  }));

  socket.on("room:join", (raw, callback) => run(callback, () => {
    const input = joinRoomSchema.parse(raw);
    const room = rooms.get(input.code);
    if (!room) throw new Error("Room not found");
    const { player } = room.join(input.name, socket.id, input.token);
    sessions.set(socket.id, { code: input.code, playerId: player.id });
    socket.join(input.code);
    broadcast(input.code);
    return { ok: true, code: input.code, token: player.token };
  }));

  const command = <T>(event: string, schema: { parse(value: unknown): T }, action: (room: GameRoom, playerId: string, input: T) => void) => {
    socket.on(event, (raw, callback) => run(callback, () => {
      const input = schema.parse(raw);
      const session = sessions.get(socket.id);
      if (!session) throw new Error("Join a room first");
      const room = rooms.get(session.code);
      if (!room) throw new Error("Room not found");
      action(room, session.playerId, input);
      broadcast(session.code);
    }));
  };

  command("match:start", roomCommandSchema, (room, playerId) => room.start(playerId));
  command("lobby:settings", lobbySettingsSchema, (room, playerId, input) => room.updateSettings(playerId, input));
  command("board:shuffle", roomCommandSchema, (room, playerId) => room.shuffleLobbyBoard(playerId));
  command("placement:place", placeRobotSchema, (room, playerId, input) => room.place(playerId, input.robot, input.position));
  command("placement:randomize", roomCommandSchema, (room, playerId) => room.randomizePlacement(playerId));
  command("placement:confirm", roomCommandSchema, (room, playerId) => room.confirmPlacement(playerId));
  command("bid:submit", bidSchema, (room, playerId, input) => room.bid(playerId, input.count));
  command("proof:move", moveSchema, (room, playerId, input) => room.move(playerId, input.robot, input.direction));
  command("proof:reset", roomCommandSchema, (room, playerId) => room.resetProof(playerId));
  command("match:end", roomCommandSchema, (room, playerId) => room.endMatch(playerId));
  command("match:lobby", roomCommandSchema, (room, playerId) => room.returnToLobby(playerId));

  socket.on("disconnect", () => {
    const session = sessions.get(socket.id);
    sessions.delete(socket.id);
    if (session) rooms.get(session.code)?.disconnect(socket.id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    room.expireDisconnected(now);
    if (room.isEmptyExpired(now)) rooms.delete(code);
  }
}, 5_000).unref();

if (process.env.NODE_ENV === "production") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const client = path.resolve(here, "../../client/dist");
  app.use(express.static(client));
  app.get("*", (_request, response) => response.sendFile(path.join(client, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => {
  console.log(`Robot Rebound API listening on http://localhost:${port}`);
  if (process.env.NODE_ENV !== "production") console.log("Open the game at http://127.0.0.1:5173");
});
