import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  bidSchema, createRoomSchema, discordTokenExchangeSchema, joinRoomSchema, lobbySettingsSchema, moveSchema, placeRobotSchema, reviewSelectSchema, roomCommandSchema,
  type CommandResult
} from "@robot-rebound/shared";
import { exchangeDiscordCode, type DiscordJoinTicket } from "./discord.js";
import { createRoomCode, GameRoom } from "./room.js";

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.get("/health", (_request, response) => response.json({ ok: true }));
app.post("/api/discord/token", async (request, response) => {
  try {
    const input = discordTokenExchangeSchema.parse(request.body);
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!clientId || !clientSecret || !botToken) throw new Error("Discord server credentials are not configured");
    const exchangeInput: Parameters<typeof exchangeDiscordCode>[0] & { redirectUri?: string } = {
      clientId,
      clientSecret,
      botToken,
      code: input.code,
      instanceId: input.instanceId
    } satisfies Parameters<typeof exchangeDiscordCode>[0];
    const redirectUri = process.env.DISCORD_REDIRECT_URI ?? process.env.APP_BASE_URL;
    if (redirectUri) exchangeInput.redirectUri = redirectUri;
    const { accessToken, ticket } = await exchangeDiscordCode(exchangeInput);
    const joinToken = randomUUID();
    discordSessions.set(joinToken, { ...ticket });
    response.json({
      ok: true,
      accessToken,
      joinToken,
      user: {
        id: ticket.user.id,
        username: ticket.user.username,
        globalName: ticket.user.global_name
      }
    });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unable to authenticate with Discord" });
  }
});
if (process.env.NODE_ENV !== "production") {
  app.get("/", (request, response) => response.redirect(`http://${request.hostname}:5173`));
}
const server = createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const rooms = new Map<string, GameRoom>();
const sessions = new Map<string, { code: string; playerId: string }>();
const discordSessions = new Map<string, DiscordJoinTicket>();
let lastCreatedBoardId: string | undefined;

io.use((socket, next) => {
  const auth = socket.handshake.auth as { mode?: string; joinToken?: string } | undefined;
  if (auth?.mode !== "discord") return next();
  if (!auth.joinToken) return next(new Error("Missing Discord session"));
  const session = discordSessions.get(auth.joinToken);
  if (!session) return next(new Error("Discord session expired"));
  if (session.expiresAt <= Date.now()) {
    discordSessions.delete(auth.joinToken);
    return next(new Error("Discord session expired"));
  }
  (socket.data as { discordSession?: DiscordJoinTicket }).discordSession = session;
  next();
});

function broadcast(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("room:snapshot", room.snapshot(player.id));
  }
}

function run(callback: (result: CommandResult) => void, action: () => CommandResult | void | Promise<CommandResult | void>): void {
  Promise.resolve()
    .then(action)
    .then((result) => callback(result ?? { ok: true }))
    .catch((error) => {
      const issues = typeof error === "object" && error !== null && "issues" in error ? (error as { issues?: Array<{ message?: string }> }).issues : undefined;
      callback({ ok: false, error: issues?.[0]?.message ?? (error instanceof Error ? error.message : "Unexpected error") });
    });
}

io.on("connection", (socket) => {
  socket.on("room:create", (raw, callback) => run(callback, () => {
    const input = createRoomSchema.parse(raw);
    const code = createRoomCode(new Set(rooms.keys()));
    const room = new GameRoom(code, input.name, 30, socket.id, broadcast, Math.random, "unlimited", lastCreatedBoardId);
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

  socket.on("room:discord-join", (raw, callback) => run(callback, () => {
    if (raw && typeof raw === "object" && "joinToken" in raw) throw new Error("Discord sessions are authenticated out of band");
    const discordSession = (socket.data as { discordSession?: DiscordJoinTicket }).discordSession;
    if (!discordSession) throw new Error("Missing Discord session");
    const room = rooms.get(discordSession.instanceId) ?? (() => {
      const created = new GameRoom(
        discordSession.instanceId,
        displayNameForDiscord(discordSession.user),
        30,
        socket.id,
        broadcast,
        Math.random,
        "unlimited",
        lastCreatedBoardId,
        discordSession.user.id
      );
      lastCreatedBoardId = created.board.id;
      rooms.set(created.code, created);
      return created;
    })();
    const { player } = room.join(displayNameForDiscord(discordSession.user), socket.id, undefined, discordSession.user.id);
    sessions.set(socket.id, { code: room.code, playerId: player.id });
    socket.join(room.code);
    broadcast(room.code);
    return { ok: true, code: room.code };
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
  command("review:select", reviewSelectSchema, (room, playerId, input) => room.selectReviewRobot(playerId, input.robot));
  command("review:move", moveSchema, (room, playerId, input) => room.moveReviewRobot(playerId, input.robot, input.direction));
  command("review:reset", roomCommandSchema, (room, playerId) => room.resetReview(playerId));
  command("review:advance", roomCommandSchema, (room, playerId) => room.advanceReview(playerId));
  command("match:end", roomCommandSchema, (room, playerId) => room.endMatch(playerId));
  command("match:lobby", roomCommandSchema, (room, playerId) => room.returnToLobby(playerId));

  socket.on("disconnect", () => {
    const session = sessions.get(socket.id);
    sessions.delete(socket.id);
    delete (socket.data as { discordSession?: DiscordJoinTicket }).discordSession;
    if (session) rooms.get(session.code)?.disconnect(socket.id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    room.expireDisconnected(now);
    if (room.isEmptyExpired(now)) rooms.delete(code);
  }
  for (const [joinToken, session] of discordSessions) {
    if (session.expiresAt <= now) discordSessions.delete(joinToken);
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

function displayNameForDiscord(user: DiscordJoinTicket["user"]): string {
  return (user.global_name ?? user.username).trim() || "Player";
}
