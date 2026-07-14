import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classicBoard, legalMoves, randomRobotPositions } from "@robot-rebound/shared";
import { GameRoom } from "./room.js";

describe("GameRoom", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs placement, timed bidding, ordered proofs, and an all-fail retry", () => {
    const broadcasts: string[] = [];
    const room = new GameRoom("ABC234", "Host", 30, "socket-1", (code) => broadcasts.push(code), () => 0.5);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    room.start(host.id);
    expect(room.phase.kind).toBe("placement");

    if (room.phase.kind !== "placement") throw new Error("Expected placement");
    const placer = room.phase.placerId;
    const cells = [[0, 0], [0, 5], [5, 0], [15, 15], [10, 10]] as const;
    (["red", "blue", "green", "yellow", "silver"] as const).forEach((robot, index) => room.place(placer, robot, { row: cells[index]![0], col: cells[index]![1] }));
    room.confirmPlacement(placer);
    expect(room.phase.kind).toBe("solving");

    room.bid(host.id, 8);
    room.bid(guest.id, 5);
    expect((room.phase as { kind: string }).kind).toBe("proving");
    const firstProof = room.snapshot(host.id);
    expect(firstProof.phase).toBe("proving");
    if (firstProof.phase !== "proving") throw new Error("Expected proof");
    expect(firstProof.bids).toHaveLength(2);

    vi.advanceTimersByTime(60_000);
    expect(room.snapshot(host.id).phase).toBe("proving");
    vi.advanceTimersByTime(60_000);
    expect(room.snapshot(host.id).phase).toBe("solving");
    expect(broadcasts.length).toBeGreaterThan(5);
  });

  it("rejects duplicate names and non-host starts", () => {
    const room = new GameRoom("ABC234", "Ada", 45, "socket-1", () => undefined);
    expect(() => room.join("ada", "socket-2")).toThrow(/already in use/);
    const guest = room.join("Grace", "socket-3").player;
    expect(() => room.start(guest.id)).toThrow(/host/);
  });

  it("reconnects Discord users by account id and resolves display-name collisions", () => {
    const room = new GameRoom("ABC234", "Ada", 45, "socket-1", () => undefined);
    const guest = room.join("Ada", "socket-2", undefined, "123456789012345678").player;
    expect(guest.name).toMatch(/^Ada#/);
    room.disconnect("socket-2");
    const reconnected = room.join("Ada", "socket-3", undefined, "123456789012345678").player;
    expect(reconnected.id).toBe(guest.id);
    expect(reconnected.connected).toBe(true);
    expect(reconnected.name).toBe(guest.name);
  });

  it("can exclude the preceding room board during room creation", () => {
    const first = new GameRoom("ABC234", "Ada", 45, "socket-1", () => undefined, () => 0.99);
    const second = new GameRoom("DEF567", "Grace", 45, "socket-2", () => undefined, () => 0.99, 60, first.board.id);
    expect(second.board.id).not.toBe(first.board.id);
  });

  it("lets only the host end an active match using current scores", () => {
    const room = new GameRoom("ABC234", "Host", 45, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    room.start(host.id);
    host.score = 2; guest.score = 1;
    expect(() => room.endMatch(guest.id)).toThrow(/host/);
    room.endMatch(host.id);
    const snapshot = room.snapshot(host.id);
    expect(snapshot.phase).toBe("results");
    if (snapshot.phase !== "results") throw new Error("Expected results");
    expect(snapshot.winners).toEqual([host.id]);
  });

  it("lets the host repeatedly shuffle to a different board only in the lobby", () => {
    const room = new GameRoom("ABC234", "Host", 45, "socket-1", () => undefined, () => 0.99);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    const first = room.board.id;
    expect(() => room.shuffleLobbyBoard(guest.id)).toThrow(/host/);
    room.shuffleLobbyBoard(host.id);
    const second = room.board.id;
    expect(second).not.toBe(first);
    room.shuffleLobbyBoard(host.id);
    expect(room.board.id).not.toBe(second);
    room.start(host.id);
    expect(() => room.shuffleLobbyBoard(host.id)).toThrow(/lobby/);
  });

  it("lets the host configure timers and a multi-cycle round deck before starting", () => {
    const room = new GameRoom("ABC234", "Host", 45, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    expect(() => room.updateSettings(guest.id, { biddingSeconds: 15, proofSeconds: 30, roundCount: 20 })).toThrow(/host/);
    room.updateSettings(host.id, { biddingSeconds: 15, proofSeconds: "unlimited", roundCount: 20 });
    expect(room.snapshot(host.id)).toMatchObject({ biddingSeconds: 15, proofSeconds: "unlimited", roundCount: 20 });
    room.start(host.id);
    expect(room.targetDeck).toHaveLength(20);
    expect(new Set(room.targetDeck.slice(0, 17).map((target) => target.id)).size).toBe(17);
    expect(() => room.updateSettings(host.id, { biddingSeconds: 30, proofSeconds: 30, roundCount: 5 })).toThrow(/lobby/);
  });

  it("starts with valid positions and restricts placement randomization to the placer", () => {
    const room = new GameRoom("ABC234", "Ada", 45, "socket-1", () => undefined, () => 0.25);
    const guest = room.join("Grace", "socket-2").player;
    room.start(room.players[0]!.id);
    const snapshot = room.snapshot(guest.id);
    expect(snapshot.phase).toBe("placement");
    if (snapshot.phase !== "placement") throw new Error("Expected placement");
    expect(Object.keys(snapshot.robots)).toHaveLength(5);
    const before = structuredClone(snapshot.robots);
    const nonPlacer = snapshot.placerId === guest.id ? room.players[0]!.id : guest.id;
    expect(() => room.randomizePlacement(nonPlacer)).toThrow(/designated placer/);
    room.randomizePlacement(snapshot.placerId);
    expect(room.snapshot(guest.id).phase).toBe("placement");
    expect(before).toEqual(snapshot.robots);
  });

  it("begins proof immediately when the bid timer is zero", () => {
    const room = new GameRoom("ABC234", "Solo", 0, "socket-1", () => undefined, () => 0.25);
    const player = room.players[0]!;
    room.start(player.id);
    if (room.phase.kind !== "placement") throw new Error("Expected placement");
    room.confirmPlacement(room.phase.placerId);
    room.bid(player.id, 7);
    const snapshot = room.snapshot(player.id);
    expect(snapshot.phase).toBe("proving");
    if (snapshot.phase !== "proving") throw new Error("Expected proving");
    expect(snapshot.bidCount).toBe(7);
  });

  it("supports finite and unlimited proof durations", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const finite = new GameRoom("ABC234", "Timed", 0, "finite-socket", () => undefined, () => 0.25, 15);
    finite.start(finite.players[0]!.id);
    if (finite.phase.kind !== "placement") throw new Error("Expected placement");
    finite.confirmPlacement(finite.phase.placerId);
    finite.bid(finite.players[0]!.id, 7);
    const timedSnapshot = finite.snapshot(finite.players[0]!.id);
    expect(timedSnapshot.phase).toBe("proving");
    if (timedSnapshot.phase !== "proving") throw new Error("Expected proving");
    expect(timedSnapshot.deadline).toBe(Date.now() + 15_000);

    const unlimited = new GameRoom("DEF567", "Untimed", 0, "unlimited-socket", () => undefined, () => 0.25, "unlimited");
    unlimited.start(unlimited.players[0]!.id);
    if (unlimited.phase.kind !== "placement") throw new Error("Expected placement");
    unlimited.confirmPlacement(unlimited.phase.placerId);
    unlimited.bid(unlimited.players[0]!.id, 7);
    const unlimitedSnapshot = unlimited.snapshot(unlimited.players[0]!.id);
    expect(unlimitedSnapshot.phase).toBe("proving");
    if (unlimitedSnapshot.phase !== "proving") throw new Error("Expected proving");
    expect(unlimitedSnapshot.deadline).toBeNull();
    vi.advanceTimersByTime(300_000);
    expect(unlimited.snapshot(unlimited.players[0]!.id).phase).toBe("proving");
    unlimited.disconnect("unlimited-socket");
    unlimited.expireDisconnected(Date.now() + 120_000);
    expect(unlimited.snapshot(unlimited.players[0]!.id).phase).toBe("solving");
  });

  it("reuses the solved round's starting positions for the next placement", () => {
    const room = new GameRoom("ABC234", "Solo", 0, "socket-1", () => undefined, () => 0.25);
    const player = room.players[0]!;
    room.start(player.id);
    room.board = classicBoard;
    const target = classicBoard.targets.find((candidate) => candidate.robot !== "wild")!;
    if (target.robot === "wild") throw new Error("Expected colored target");
    const anotherTarget = classicBoard.targets.find((candidate) => candidate.id !== target.id)!;
    const starting = { ...randomRobotPositions(classicBoard, () => 0.25), [target.robot]: target.position };
    const mover = (["red", "blue", "green", "yellow", "silver"] as const)
      .find((robot) => robot !== target.robot && legalMoves(classicBoard, starting, robot).length > 0)!;
    const move = legalMoves(classicBoard, starting, mover)[0]!;
    room.targetDeck = [target, anotherTarget];
    room.phase = { kind: "proving", round: 1, startRobots: structuredClone(starting), robots: structuredClone(starting), target, bids: [{ playerId: player.id, count: 1, receivedAt: 1, order: 1 }], bidIndex: 0, moveCount: 0, deadline: Date.now() + 60_000 };
    room.move(player.id, mover, move.direction);
    expect(player.wonTargets).toEqual([target]);
    const snapshot = room.snapshot(player.id);
    expect(snapshot.phase).toBe("placement");
    if (snapshot.phase !== "placement") throw new Error("Expected placement");
    expect(snapshot.robots).toEqual(starting);
  });
});
