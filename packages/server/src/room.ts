import { randomBytes, randomUUID } from "node:crypto";
import {
  createRandomBoard, moveRobot, randomRobotPositions, targetSatisfied, validatePlacement,
  type BidView, type BiddingSeconds, type BoardDefinition, type Direction, type PlayerView, type Position, type ProofSeconds, type RobotId,
  type RobotPositions, type RoomSnapshot, type Target
} from "@robot-rebound/shared";

interface Player {
  id: string; token: string; name: string; score: number; connected: boolean;
  socketId?: string; isHost: boolean; eligible: boolean; disconnectedAt?: number;
  wonTargets: Target[];
}
interface Bid extends BidView { order: number }
type Phase =
  | { kind: "lobby" }
  | { kind: "placement"; round: number; placerId: string; robots: RobotPositions }
  | { kind: "solving"; round: number; robots: RobotPositions; target: Target }
  | { kind: "bidding"; round: number; robots: RobotPositions; target: Target; bids: Bid[]; deadline: number }
  | { kind: "proving"; round: number; startRobots: RobotPositions; robots: RobotPositions; target: Target; bids: Bid[]; bidIndex: number; moveCount: number; deadline: number | null }
  | { kind: "results"; winners: string[] };

export type Broadcast = (code: string) => void;
const copyRobots = (robots: RobotPositions): RobotPositions => structuredClone(robots);
const shuffle = <T>(items: T[], random: () => number): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
};

export class GameRoom {
  readonly code: string;
  readonly players: Player[] = [];
  biddingSeconds: BiddingSeconds;
  proofSeconds: ProofSeconds;
  roundCount = 17;
  phase: Phase = { kind: "lobby" };
  placementOrder: string[] = [];
  targetDeck: Target[] = [];
  board: BoardDefinition;
  placementIndex = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private bidSequence = 0;

  constructor(code: string, name: string, biddingSeconds: BiddingSeconds, socketId: string, private readonly broadcast: Broadcast, private readonly random = Math.random, proofSeconds: ProofSeconds = 60, excludedBoardId?: string) {
    this.code = code;
    this.biddingSeconds = biddingSeconds;
    this.proofSeconds = proofSeconds;
    this.board = createRandomBoard(this.random, excludedBoardId);
    this.players.push(this.newPlayer(name, socketId, true, true));
  }

  private newPlayer(name: string, socketId: string, isHost: boolean, eligible: boolean): Player {
    return { id: randomUUID(), token: randomBytes(24).toString("base64url"), name, score: 0, connected: true, socketId, isHost, eligible, wonTargets: [] };
  }

  join(name: string, socketId: string, token?: string): { player: Player; reconnected: boolean } {
    const returning = token ? this.players.find((player) => player.token === token) : undefined;
    if (returning) {
      returning.connected = true;
      returning.socketId = socketId;
      delete returning.disconnectedAt;
      this.broadcast(this.code);
      return { player: returning, reconnected: true };
    }
    if (this.players.length >= 10) throw new Error("Room is full");
    if (this.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("That display name is already in use");
    const eligible = this.phase.kind === "lobby";
    const player = this.newPlayer(name, socketId, false, eligible);
    this.players.push(player);
    if (this.phase.kind !== "lobby") this.placementOrder.push(player.id);
    this.broadcast(this.code);
    return { player, reconnected: false };
  }

  start(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase.kind !== "lobby") throw new Error("The match has already started");
    for (const player of this.players) { player.score = 0; player.eligible = true; player.wonTargets = []; }
    this.placementOrder = shuffle(this.players.map((player) => player.id), this.random);
    this.board = createRandomBoard(this.random, this.board.id);
    this.targetDeck = this.buildTargetDeck();
    this.placementIndex = 0;
    this.beginPlacement(1, randomRobotPositions(this.board, this.random));
  }

  shuffleLobbyBoard(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase.kind !== "lobby") throw new Error("The board can only be shuffled in the lobby");
    this.board = createRandomBoard(this.random, this.board.id);
    this.broadcast(this.code);
  }

  updateSettings(playerId: string, settings: { biddingSeconds: BiddingSeconds; proofSeconds: ProofSeconds; roundCount: number }): void {
    this.requireHost(playerId);
    if (this.phase.kind !== "lobby") throw new Error("Match settings can only be changed in the lobby");
    this.biddingSeconds = settings.biddingSeconds;
    this.proofSeconds = settings.proofSeconds;
    this.roundCount = settings.roundCount;
    this.broadcast(this.code);
  }

  place(playerId: string, robot: RobotId, position: Position): void {
    if (this.phase.kind !== "placement") throw new Error("Robots cannot be placed right now");
    if (this.phase.placerId !== playerId) throw new Error("Only the designated placer can move robots");
    const next = { ...this.phase.robots, [robot]: position };
    const duplicate = Object.entries(next).some(([id, cell]) => id !== robot && cell.row === position.row && cell.col === position.col);
    if (duplicate) throw new Error("Robots must occupy different cells");
    if (this.board.blocked.some((cell) => cell.row === position.row && cell.col === position.col)) throw new Error("That cell is blocked");
    if (this.board.targets.some((target) => target.position.row === position.row && target.position.col === position.col)) throw new Error("Robots cannot start on a destination");
    this.phase.robots = next;
    this.broadcast(this.code);
  }

  randomizePlacement(playerId: string): void {
    if (this.phase.kind !== "placement") throw new Error("Robots cannot be randomized right now");
    if (this.phase.placerId !== playerId) throw new Error("Only the designated placer can randomize robots");
    this.phase.robots = randomRobotPositions(this.board, this.random);
    this.broadcast(this.code);
  }

  confirmPlacement(playerId: string): void {
    if (this.phase.kind !== "placement" || this.phase.placerId !== playerId) throw new Error("Only the designated placer can confirm");
    const error = validatePlacement(this.board, this.phase.robots);
    if (error) throw new Error(error);
    const target = this.targetDeck[0];
    if (!target) throw new Error("No destinations remain");
    this.phase = { kind: "solving", round: this.phase.round, robots: copyRobots(this.phase.robots), target };
    this.broadcast(this.code);
  }

  bid(playerId: string, count: number): void {
    const player = this.requirePlayer(playerId);
    if (!player.eligible || !player.connected) throw new Error("You are not eligible this round");
    if (this.phase.kind === "solving") {
      const now = Date.now();
      this.phase = { kind: "bidding", round: this.phase.round, robots: this.phase.robots, target: this.phase.target, bids: [], deadline: now + this.biddingSeconds * 1000 };
    }
    if (this.phase.kind !== "bidding") throw new Error("Bidding is closed");
    if (this.phase.bids.some((bid) => bid.playerId === playerId)) throw new Error("Each player may bid only once");
    this.phase.bids.push({ playerId, count, receivedAt: Date.now(), order: this.bidSequence++ });
    const expectedBidders = this.players.filter((candidate) => candidate.connected && candidate.eligible);
    const everyoneBid = expectedBidders.every((candidate) => this.phase.kind === "bidding" && this.phase.bids.some((bid) => bid.playerId === candidate.id));
    if (this.biddingSeconds === 0 || everyoneBid) {
      this.beginProof();
      return;
    }
    if (this.phase.bids.length === 1) this.schedule(this.biddingSeconds * 1000, () => this.beginProof());
    this.broadcast(this.code);
  }

  move(playerId: string, robot: RobotId, direction: Direction): void {
    if (this.phase.kind !== "proving") throw new Error("No proof is active");
    const active = this.orderedBids(this.phase.bids)[this.phase.bidIndex];
    if (active?.playerId !== playerId) throw new Error("Only the active bidder can move robots");
    const destination = moveRobot(this.board, this.phase.robots, robot, direction);
    if (!destination) throw new Error("That robot cannot move in that direction");
    this.phase.robots = { ...this.phase.robots, [robot]: destination };
    this.phase.moveCount += 1;
    if (this.phase.moveCount === active.count) {
      if (targetSatisfied(this.phase.target, this.phase.robots)) this.completeRound(playerId);
      else this.advanceProof();
      return;
    }
    this.broadcast(this.code);
  }

  resetProof(playerId: string): void {
    if (this.phase.kind !== "proving") throw new Error("No proof is active");
    const active = this.orderedBids(this.phase.bids)[this.phase.bidIndex];
    if (active?.playerId !== playerId) throw new Error("Only the active bidder can reset");
    this.phase.robots = copyRobots(this.phase.startRobots);
    this.phase.moveCount = 0;
    this.broadcast(this.code);
  }

  returnToLobby(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase.kind !== "results") throw new Error("The match is not finished");
    this.clearTimer();
    for (const player of this.players) { player.score = 0; player.eligible = true; player.wonTargets = []; }
    this.phase = { kind: "lobby" };
    this.broadcast(this.code);
  }

  endMatch(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase.kind === "lobby" || this.phase.kind === "results") throw new Error("There is no active match to end");
    this.clearTimer();
    const best = Math.max(...this.players.map((player) => player.score));
    this.phase = { kind: "results", winners: this.players.filter((player) => player.score === best).map((player) => player.id) };
    this.broadcast(this.code);
  }

  disconnect(socketId: string): void {
    const player = this.players.find((candidate) => candidate.socketId === socketId);
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    delete player.socketId;
    this.broadcast(this.code);
  }

  expireDisconnected(now = Date.now()): void {
    const expired = this.players.filter((player) => !player.connected && player.disconnectedAt !== undefined && now - player.disconnectedAt >= 120_000);
    for (const player of expired) {
      const wasHost = player.isHost;
      player.isHost = false;
      if (this.phase.kind === "placement" && this.phase.placerId === player.id) {
        this.placementIndex = (this.placementIndex + 1) % Math.max(1, this.placementOrder.length);
        this.beginPlacement(this.phase.round, this.phase.robots);
      }
      if (this.phase.kind === "proving" && this.phase.deadline === null) {
        const active = this.orderedBids(this.phase.bids)[this.phase.bidIndex];
        if (active?.playerId === player.id) this.advanceProof();
      }
      if (wasHost) {
        const replacement = this.placementOrder.map((id) => this.players.find((candidate) => candidate.id === id)).find((candidate) => candidate?.connected)
          ?? this.players.find((candidate) => candidate.connected);
        if (replacement) replacement.isHost = true;
      }
    }
    if (expired.length) this.broadcast(this.code);
  }

  isEmptyExpired(now = Date.now()): boolean {
    return this.players.every((player) => !player.connected && player.disconnectedAt !== undefined && now - player.disconnectedAt >= 120_000);
  }

  snapshot(selfId: string): RoomSnapshot {
    const base = {
      code: this.code, selfId, hostId: this.players.find((player) => player.isHost)?.id ?? "",
      players: this.players.map<PlayerView>((player) => ({ id: player.id, name: player.name, score: player.score, connected: player.connected, isHost: player.isHost, eligible: player.eligible, wonTargets: player.wonTargets })),
      biddingSeconds: this.biddingSeconds, proofSeconds: this.proofSeconds, roundCount: this.roundCount, board: this.board
    };
    const phase = this.phase;
    if (phase.kind === "lobby") return { ...base, phase: "lobby" };
    if (phase.kind === "placement") return { ...base, phase: "placement", round: phase.round, placerId: phase.placerId, robots: phase.robots };
    if (phase.kind === "solving") return { ...base, phase: "solving", round: phase.round, robots: phase.robots, target: phase.target };
    if (phase.kind === "bidding") return { ...base, phase: "bidding", round: phase.round, robots: phase.robots, target: phase.target, bids: phase.bids, deadline: phase.deadline };
    if (phase.kind === "results") return { ...base, phase: "results", winners: phase.winners };
    const active = this.orderedBids(phase.bids)[phase.bidIndex]!;
    return { ...base, phase: "proving", round: phase.round, robots: phase.robots, target: phase.target, bids: phase.bids, activeBidderId: active.playerId, bidCount: active.count, moveCount: phase.moveCount, deadline: phase.deadline };
  }

  private beginPlacement(round: number, robots: RobotPositions): void {
    this.clearTimer();
    for (const player of this.players) player.eligible = true;
    let attempts = 0;
    while (attempts < this.placementOrder.length) {
      const id = this.placementOrder[this.placementIndex % this.placementOrder.length];
      const player = this.players.find((candidate) => candidate.id === id);
      if (player?.connected) {
        this.phase = { kind: "placement", round, placerId: id!, robots: copyRobots(robots) };
        this.broadcast(this.code);
        return;
      }
      this.placementIndex = (this.placementIndex + 1) % this.placementOrder.length;
      attempts++;
    }
  }

  private beginProof(): void {
    if (this.phase.kind !== "bidding") return;
    if (!this.phase.bids.length) {
      this.phase = { kind: "solving", round: this.phase.round, robots: this.phase.robots, target: this.phase.target };
      this.broadcast(this.code);
      return;
    }
    const deadline = this.proofSeconds === "unlimited" ? null : Date.now() + this.proofSeconds * 1000;
    this.phase = { kind: "proving", round: this.phase.round, startRobots: copyRobots(this.phase.robots), robots: copyRobots(this.phase.robots), target: this.phase.target, bids: this.phase.bids, bidIndex: 0, moveCount: 0, deadline };
    if (this.proofSeconds !== "unlimited") this.schedule(this.proofSeconds * 1000, () => this.advanceProof());
    this.broadcast(this.code);
  }

  private advanceProof(): void {
    if (this.phase.kind !== "proving") return;
    const nextIndex = this.phase.bidIndex + 1;
    if (nextIndex >= this.phase.bids.length) {
      this.clearTimer();
      this.phase = { kind: "solving", round: this.phase.round, robots: copyRobots(this.phase.startRobots), target: this.phase.target };
      this.broadcast(this.code);
      return;
    }
    this.phase.bidIndex = nextIndex;
    this.phase.robots = copyRobots(this.phase.startRobots);
    this.phase.moveCount = 0;
    this.phase.deadline = this.proofSeconds === "unlimited" ? null : Date.now() + this.proofSeconds * 1000;
    if (this.proofSeconds !== "unlimited") this.schedule(this.proofSeconds * 1000, () => this.advanceProof());
    this.broadcast(this.code);
  }

  private completeRound(playerId: string): void {
    if (this.phase.kind !== "proving") return;
    const nextStartingPositions = copyRobots(this.phase.startRobots);
    const nextRound = this.phase.round + 1;
    this.clearTimer();
    const winner = this.requirePlayer(playerId);
    winner.score++;
    winner.wonTargets.push(this.phase.target);
    this.targetDeck.shift();
    if (!this.targetDeck.length) {
      const best = Math.max(...this.players.map((player) => player.score));
      this.phase = { kind: "results", winners: this.players.filter((player) => player.score === best).map((player) => player.id) };
      this.broadcast(this.code);
      return;
    }
    this.placementIndex = (this.placementIndex + 1) % this.placementOrder.length;
    this.beginPlacement(nextRound, nextStartingPositions);
  }

  private orderedBids(bids: Bid[]): Bid[] { return [...bids].sort((a, b) => a.count - b.count || a.order - b.order); }
  private buildTargetDeck(): Target[] {
    const deck: Target[] = [];
    while (deck.length < this.roundCount) {
      const cycle = shuffle(this.board.targets, this.random);
      deck.push(...cycle.slice(0, this.roundCount - deck.length));
    }
    return deck;
  }
  private requirePlayer(id: string): Player { const player = this.players.find((candidate) => candidate.id === id); if (!player) throw new Error("Player not found"); return player; }
  private requireHost(id: string): Player { const player = this.requirePlayer(id); if (!player.isHost) throw new Error("Only the host can do that"); return player; }
  private schedule(delay: number, action: () => void): void { this.clearTimer(); this.timer = setTimeout(action, delay); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); delete this.timer; }
}

export function createRoomCode(existing: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do { code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); } while (existing.has(code));
  return code;
}
