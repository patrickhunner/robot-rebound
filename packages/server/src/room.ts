import { randomBytes, randomUUID } from "node:crypto";
import {
  animationDurationMs, createRandomBoard, moveRobot, randomRobotPositions, targetSatisfied, validatePlacement,
  type AnimationSpeed, type BidView, type BiddingSeconds, type BoardDefinition, type Direction, type PlayerView, type Position, type ProofSeconds, type RobotId,
  type RobotLocks, type RobotPositions, type RoomSnapshot, type SolutionMove, type Target
} from "@robot-rebound/shared";

interface Player {
  id: string; token: string; name: string; score: number; connected: boolean;
  socketId?: string; isHost: boolean; eligible: boolean; disconnectedAt?: number;
  wonTargets: Target[];
  discordUserId?: string;
}
interface Bid extends BidView { order: number }
type Phase =
  | { kind: "lobby" }
  | { kind: "placement"; round: number; placerId: string; robots: RobotPositions }
  | { kind: "solving"; round: number; robots: RobotPositions; target: Target }
  | { kind: "bidding"; round: number; robots: RobotPositions; target: Target; bids: Bid[]; deadline: number }
  | { kind: "proving"; round: number; startRobots: RobotPositions; robots: RobotPositions; target: Target; bids: Bid[]; bidIndex: number; moveCount: number; deadline: number | null }
  | { kind: "review"; round: number; startRobots: RobotPositions; robots: RobotPositions; target: Target; winnerId: string; winningMoveCount: number; moveCount: number; locks: RobotLocks; playback?: { moves: SolutionMove[]; index: number } }
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
  animationSpeed: AnimationSpeed = 5;
  phase: Phase = { kind: "lobby" };
  placementOrder: string[] = [];
  targetDeck: Target[] = [];
  board: BoardDefinition;
  placementIndex = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private bidSequence = 0;

  constructor(code: string, name: string, biddingSeconds: BiddingSeconds, socketId: string, private readonly broadcast: Broadcast, private readonly random = Math.random, proofSeconds: ProofSeconds = "unlimited", excludedBoardId?: string, discordUserId?: string) {
    this.code = code;
    this.biddingSeconds = biddingSeconds;
    this.proofSeconds = proofSeconds;
    this.board = createRandomBoard(this.random, excludedBoardId);
    this.players.push(this.newPlayer(name, socketId, true, true, discordUserId));
  }

  private newPlayer(name: string, socketId: string, isHost: boolean, eligible: boolean, discordUserId?: string): Player {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString("base64url"),
      name,
      score: 0,
      connected: true,
      socketId,
      isHost,
      eligible,
      wonTargets: [],
      ...(discordUserId ? { discordUserId } : {})
    };
  }

  join(name: string, socketId: string, token?: string, discordUserId?: string): { player: Player; reconnected: boolean } {
    const returning = discordUserId ? this.players.find((player) => player.discordUserId === discordUserId) : token ? this.players.find((player) => player.token === token) : undefined;
    if (returning) {
      returning.name = this.resolveName(name, returning.id, discordUserId);
      if (discordUserId) returning.discordUserId = discordUserId;
      returning.connected = true;
      returning.socketId = socketId;
      delete returning.disconnectedAt;
      this.assignRandomConnectedHost();
      this.broadcast(this.code);
      return { player: returning, reconnected: true };
    }
    if (this.players.length >= 10) throw new Error("Room is full");
    const resolvedName = this.resolveName(name, undefined, discordUserId);
    if (!discordUserId && this.players.some((player) => player.name.toLocaleLowerCase() === resolvedName.toLocaleLowerCase())) throw new Error("That display name is already in use");
    const player = this.newPlayer(resolvedName, socketId, false, true, discordUserId);
    this.players.push(player);
    this.assignRandomConnectedHost();
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

  updateAnimationSpeed(playerId: string, speed: AnimationSpeed): void {
    this.requireHost(playerId);
    this.animationSpeed = speed;
    if (this.phase.kind === "review" && this.phase.playback) {
      this.schedule(animationDurationMs(speed), () => this.advancePlayback());
    }
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

  selectReviewRobot(playerId: string, robot: RobotId | null): void {
    if (this.phase.kind !== "review") throw new Error("The round is not being reviewed");
    if (this.phase.playback) throw new Error("A strategy is currently playing");
    this.requireConnectedPlayer(playerId);
    if (robot) {
      const owner = this.phase.locks[robot];
      if (owner && owner !== playerId) throw new Error("That robot is being used by another player");
    }
    for (const id of Object.keys(this.phase.locks) as RobotId[]) {
      if (this.phase.locks[id] === playerId) delete this.phase.locks[id];
    }
    if (robot) this.phase.locks[robot] = playerId;
    this.broadcast(this.code);
  }

  moveReviewRobot(playerId: string, robot: RobotId, direction: Direction): void {
    if (this.phase.kind !== "review") throw new Error("The round is not being reviewed");
    if (this.phase.playback) throw new Error("A strategy is currently playing");
    this.requireConnectedPlayer(playerId);
    if (this.phase.locks[robot] !== playerId) throw new Error("Select that robot before moving it");
    const destination = moveRobot(this.board, this.phase.robots, robot, direction);
    if (!destination) throw new Error("That robot cannot move in that direction");
    this.phase.robots = { ...this.phase.robots, [robot]: destination };
    this.phase.moveCount++;
    this.broadcast(this.code);
  }

  resetReview(playerId: string): void {
    if (this.phase.kind !== "review") throw new Error("The round is not being reviewed");
    if (this.phase.playback) throw new Error("A strategy is currently playing");
    this.requireConnectedPlayer(playerId);
    this.phase.robots = copyRobots(this.phase.startRobots);
    this.phase.moveCount = 0;
    this.phase.locks = {};
    this.broadcast(this.code);
  }

  playReviewStrategy(playerId: string, moves: SolutionMove[]): void {
    if (this.phase.kind !== "review") throw new Error("The round is not being reviewed");
    this.requireConnectedPlayer(playerId);
    if (this.phase.playback) throw new Error("A strategy is already playing");
    if (moves.length > this.phase.winningMoveCount) throw new Error("That strategy exceeds the accepted proof count");
    let simulated = copyRobots(this.phase.startRobots);
    for (const move of moves) {
      const destination = moveRobot(this.board, simulated, move.robot, move.direction);
      if (!destination) throw new Error("That strategy contains an illegal move");
      simulated = { ...simulated, [move.robot]: destination };
    }
    if (!targetSatisfied(this.phase.target, simulated)) throw new Error("That strategy does not solve the target");
    this.phase.robots = copyRobots(this.phase.startRobots);
    this.phase.moveCount = 0;
    this.phase.locks = {};
    this.phase.playback = { moves: structuredClone(moves), index: 0 };
    this.broadcast(this.code);
    this.schedule(animationDurationMs(this.animationSpeed), () => this.advancePlayback());
  }

  advanceReview(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase.kind !== "review") throw new Error("The round is not being reviewed");
    this.clearTimer();
    const nextStartingPositions = copyRobots(this.phase.startRobots);
    const nextRound = this.phase.round + 1;
    if (!this.targetDeck.length) {
      const best = Math.max(...this.players.map((player) => player.score));
      this.phase = { kind: "results", winners: this.players.filter((player) => player.score === best).map((player) => player.id) };
      this.broadcast(this.code);
      return;
    }
    this.placementIndex = (this.placementIndex + 1) % this.placementOrder.length;
    this.beginPlacement(nextRound, nextStartingPositions);
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
    const wasHost = player.isHost;
    player.connected = false;
    player.disconnectedAt = Date.now();
    delete player.socketId;
    if (this.phase.kind === "review") {
      for (const id of Object.keys(this.phase.locks) as RobotId[]) {
        if (this.phase.locks[id] === player.id) delete this.phase.locks[id];
      }
    }
    if (wasHost) {
      player.isHost = false;
      this.assignRandomConnectedHost();
    }
    this.broadcast(this.code);
  }

  expireDisconnected(now = Date.now()): void {
    const expired = this.players.filter((player) => !player.connected && player.disconnectedAt !== undefined && now - player.disconnectedAt >= 120_000);
    for (const player of expired) {
      player.isHost = false;
      if (this.phase.kind === "placement" && this.phase.placerId === player.id) {
        this.placementIndex = (this.placementIndex + 1) % Math.max(1, this.placementOrder.length);
        this.beginPlacement(this.phase.round, this.phase.robots);
      }
      if (this.phase.kind === "proving" && this.phase.deadline === null) {
        const active = this.orderedBids(this.phase.bids)[this.phase.bidIndex];
        if (active?.playerId === player.id) this.advanceProof();
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
      biddingSeconds: this.biddingSeconds, proofSeconds: this.proofSeconds, roundCount: this.roundCount, animationSpeed: this.animationSpeed, board: this.board
    };
    const phase = this.phase;
    if (phase.kind === "lobby") return { ...base, phase: "lobby" };
    if (phase.kind === "placement") return { ...base, phase: "placement", round: phase.round, placerId: phase.placerId, robots: phase.robots };
    if (phase.kind === "solving") return { ...base, phase: "solving", round: phase.round, robots: phase.robots, target: phase.target };
    if (phase.kind === "bidding") return { ...base, phase: "bidding", round: phase.round, robots: phase.robots, target: phase.target, bids: phase.bids, deadline: phase.deadline };
    if (phase.kind === "review") return { ...base, phase: "review", round: phase.round, startRobots: phase.startRobots, robots: phase.robots, target: phase.target, winnerId: phase.winnerId, winningMoveCount: phase.winningMoveCount, moveCount: phase.moveCount, locks: phase.locks, playbackActive: Boolean(phase.playback) };
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
    const startRobots = copyRobots(this.phase.startRobots);
    const { round, target } = this.phase;
    const winningMoveCount = this.orderedBids(this.phase.bids)[this.phase.bidIndex]!.count;
    this.clearTimer();
    const winner = this.requirePlayer(playerId);
    winner.score++;
    winner.wonTargets.push(target);
    this.targetDeck.shift();
    this.phase = { kind: "review", round, startRobots, robots: copyRobots(startRobots), target, winnerId: playerId, winningMoveCount, moveCount: 0, locks: {} };
    this.broadcast(this.code);
  }

  private advancePlayback(): void {
    if (this.phase.kind !== "review" || !this.phase.playback) return;
    const move = this.phase.playback.moves[this.phase.playback.index];
    if (!move) {
      delete this.phase.playback;
      this.broadcast(this.code);
      return;
    }
    const destination = moveRobot(this.board, this.phase.robots, move.robot, move.direction);
    if (!destination) {
      delete this.phase.playback;
      this.broadcast(this.code);
      return;
    }
    this.phase.robots = { ...this.phase.robots, [move.robot]: destination };
    this.phase.moveCount++;
    this.phase.playback.index++;
    if (this.phase.playback.index >= this.phase.playback.moves.length) delete this.phase.playback;
    this.broadcast(this.code);
    if (this.phase.playback) this.schedule(animationDurationMs(this.animationSpeed), () => this.advancePlayback());
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
  private requireConnectedPlayer(id: string): Player { const player = this.requirePlayer(id); if (!player.connected) throw new Error("Player is disconnected"); return player; }
  private requireHost(id: string): Player { const player = this.requirePlayer(id); if (!player.isHost) throw new Error("Only the host can do that"); return player; }
  private assignRandomConnectedHost(): Player | undefined {
    const current = this.players.find((player) => player.isHost && player.connected);
    if (current) return current;
    for (const player of this.players) player.isHost = false;
    const candidates = this.players.filter((player) => player.connected);
    if (!candidates.length) return undefined;
    const selected = candidates[Math.floor(this.random() * candidates.length)]!;
    selected.isHost = true;
    return selected;
  }
  private schedule(delay: number, action: () => void): void { this.clearTimer(); this.timer = setTimeout(action, delay); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); delete this.timer; }
  private resolveName(name: string, selfId?: string, discordUserId?: string): string {
    const trimmed = name.trim().slice(0, 24) || "Player";
    if (!discordUserId) return trimmed;
    const taken = new Set(this.players.filter((player) => player.id !== selfId).map((player) => player.name.toLocaleLowerCase()));
    if (!taken.has(trimmed.toLocaleLowerCase())) return trimmed;
    const suffixCandidates = [4, 6, 8];
    for (const length of suffixCandidates) {
      const suffix = discordUserId.slice(-length);
      const prefixLength = Math.max(1, 24 - suffix.length - 1);
      const candidate = `${trimmed.slice(0, prefixLength).trimEnd()}#${suffix}`.slice(0, 24);
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return trimmed;
  }
}

export function createRoomCode(existing: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do { code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); } while (existing.has(code));
  return code;
}
