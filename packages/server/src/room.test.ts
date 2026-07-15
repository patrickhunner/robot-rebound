import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classicBoard, legalMoves, movementDurationMs, randomRobotPositions } from "@robot-rebound/shared";
import { GameRoom } from "./room.js";

describe("GameRoom", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs placement, timed bidding, ordered proofs, and an all-fail retry", () => {
    const broadcasts: string[] = [];
    const room = new GameRoom("ABC234", "Host", 30, "socket-1", (code) => broadcasts.push(code), () => 0.5, 60);
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

  it("randomly transfers host immediately on disconnect and preserves the former host", () => {
    const room = new GameRoom("ABC234", "Creator", 45, "socket-1", () => undefined, () => 0.75);
    const creator = room.players[0]!;
    const firstGuest = room.join("First guest", "socket-2").player;
    const secondGuest = room.join("Second guest", "socket-3").player;
    expect(creator.isHost).toBe(true);

    room.start(creator.id);
    creator.score = 3;
    room.disconnect("socket-1");

    expect(creator).toMatchObject({ connected: false, isHost: false, score: 3 });
    expect(firstGuest.isHost).toBe(false);
    expect(secondGuest.isHost).toBe(true);
    expect(room.snapshot(secondGuest.id).hostId).toBe(secondGuest.id);

    const returning = room.join("Creator", "socket-4", creator.token).player;
    expect(returning).toMatchObject({ id: creator.id, connected: true, isHost: false, score: 3 });
    expect(() => room.endMatch(returning.id)).toThrow(/host/);
    room.endMatch(secondGuest.id);
    expect(room.snapshot(secondGuest.id).phase).toBe("results");
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

  it("lets a player who joins during a round bid immediately", () => {
    const room = new GameRoom("ABC234", "Host", 45, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    room.start(host.id);
    if (room.phase.kind !== "placement") throw new Error("Expected placement");
    room.confirmPlacement(room.phase.placerId);

    const latePlayer = room.join("Late player", "socket-2").player;
    expect(latePlayer.eligible).toBe(true);
    room.bid(latePlayer.id, 8);

    const snapshot = room.snapshot(latePlayer.id);
    expect(snapshot.phase).toBe("bidding");
    if (snapshot.phase !== "bidding") throw new Error("Expected bidding");
    expect(snapshot.bids).toContainEqual(expect.objectContaining({ playerId: latePlayer.id, count: 8 }));
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

  it("enters review after a solution and reuses the round's starting positions after host advance", () => {
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
    expect(snapshot.phase).toBe("review");
    if (snapshot.phase !== "review") throw new Error("Expected review");
    expect(snapshot).toMatchObject({ robots: { ...starting, [mover]: move.destination }, startRobots: starting, moveCount: 1, winningMoveCount: 1, winnerId: player.id });
    room.advanceReview(player.id);
    const placement = room.snapshot(player.id);
    expect(placement.phase).toBe("placement");
    if (placement.phase !== "placement") throw new Error("Expected placement");
    expect(placement.robots).toEqual(starting);
  });

  it("coordinates review locks, moves, resets, and disconnect cleanup", () => {
    const room = new GameRoom("ABC234", "Host", 30, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    room.board = classicBoard;
    const target = classicBoard.targets[0]!;
    const starting = randomRobotPositions(classicBoard, () => 0.25);
    room.phase = { kind: "review", round: 1, startRobots: structuredClone(starting), robots: structuredClone(starting), target, winnerId: host.id, winningMoveCount: 6, moveCount: 0, locks: {} };
    const robot = (['red', 'blue', 'green', 'yellow', 'silver'] as const).find((id) => legalMoves(classicBoard, starting, id).length)!;
    const move = legalMoves(classicBoard, starting, robot)[0]!;
    room.selectReviewRobot(host.id, robot);
    expect(() => room.selectReviewRobot(guest.id, robot)).toThrow(/another player/);
    room.moveReviewRobot(host.id, robot, move.direction);
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", moveCount: 1 });
    room.resetReview(guest.id);
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", robots: starting, moveCount: 0, locks: {} });
    room.selectReviewRobot(host.id, robot);
    room.disconnect("socket-1");
    expect(room.snapshot(guest.id)).toMatchObject({ phase: "review", locks: {} });
  });

  it("lets only the host change the room-wide animation speed in any phase", () => {
    const room = new GameRoom("ABC234", "Host", 30, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    expect(room.snapshot(host.id).animationSpeed).toBe(5);
    expect(() => room.updateAnimationSpeed(guest.id, 8)).toThrow(/host/);
    room.updateAnimationSpeed(host.id, 8);
    expect(room.snapshot(guest.id).animationSpeed).toBe(8);
    room.start(host.id);
    room.updateAnimationSpeed(host.id, 10);
    expect(room.snapshot(host.id).animationSpeed).toBe(10);
  });

  it("runs validated review strategies at the current shared speed and locks interactions", () => {
    const room = new GameRoom("ABC234", "Host", 30, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    const guest = room.join("Guest", "socket-2").player;
    room.board = classicBoard;
    const target = classicBoard.targets.find((candidate) => candidate.robot !== "wild")!;
    if (target.robot === "wild") throw new Error("Expected colored target");
    const starting = { ...randomRobotPositions(classicBoard, () => 0.25), [target.robot]: target.position };
    const movable = (["red", "blue", "green", "yellow", "silver"] as const).filter((robot) => robot !== target.robot);
    const firstRobot = movable.find((robot) => legalMoves(classicBoard, starting, robot).length)!;
    const firstLegalMove = legalMoves(classicBoard, starting, firstRobot)[0]!;
    const first = { robot: firstRobot, direction: firstLegalMove.direction };
    const afterFirst = { ...starting, [firstRobot]: firstLegalMove.destination };
    const secondRobot = movable.find((robot) => legalMoves(classicBoard, afterFirst, robot).length)!;
    const secondLegalMove = legalMoves(classicBoard, afterFirst, secondRobot)[0]!;
    const second = { robot: secondRobot, direction: secondLegalMove.direction };
    const firstDistance = Math.abs(starting[firstRobot].row - firstLegalMove.destination.row) + Math.abs(starting[firstRobot].col - firstLegalMove.destination.col);
    const secondDistance = Math.abs(afterFirst[secondRobot].row - secondLegalMove.destination.row) + Math.abs(afterFirst[secondRobot].col - secondLegalMove.destination.col);
    room.phase = { kind: "review", round: 1, startRobots: structuredClone(starting), robots: structuredClone(afterFirst), target, winnerId: host.id, winningMoveCount: 2, moveCount: 1, locks: { red: host.id } };

    room.playReviewStrategy(guest.id, [first, second]);
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", robots: starting, moveCount: 0, locks: {}, playbackActive: true });
    expect(() => room.resetReview(host.id)).toThrow(/currently playing/);
    expect(() => room.selectReviewRobot(guest.id, "blue")).toThrow(/currently playing/);
    vi.advanceTimersByTime(movementDurationMs(5, firstDistance));
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", moveCount: 1, playbackActive: true });
    room.updateAnimationSpeed(host.id, 10);
    const currentFirstMove = movementDurationMs(5, firstDistance);
    vi.advanceTimersByTime(currentFirstMove - 1);
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", moveCount: 1 });
    vi.advanceTimersByTime(1);
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", moveCount: 2, playbackActive: true });
    vi.advanceTimersByTime(movementDurationMs(10, secondDistance));
    expect(room.snapshot(host.id)).toMatchObject({ phase: "review", moveCount: 2, playbackActive: false });
  });

  it("rejects invalid playback and cancels pending playback when the host ends the match", () => {
    const room = new GameRoom("ABC234", "Host", 30, "socket-1", () => undefined, () => 0.25);
    const host = room.players[0]!;
    room.board = classicBoard;
    const target = classicBoard.targets[0]!;
    const starting = randomRobotPositions(classicBoard, () => 0.25);
    room.phase = { kind: "review", round: 1, startRobots: structuredClone(starting), robots: structuredClone(starting), target, winnerId: host.id, winningMoveCount: 2, moveCount: 0, locks: {} };
    expect(() => room.playReviewStrategy(host.id, [{ robot: "red", direction: "north" }])).toThrow(/illegal move|does not solve/);

    const solved = { ...starting, red: target.position };
    const mover = (["blue", "green", "yellow", "silver"] as const).find((robot) => legalMoves(classicBoard, solved, robot).length)!;
    const move = legalMoves(classicBoard, solved, mover)[0]!;
    room.phase = { kind: "review", round: 1, startRobots: structuredClone(solved), robots: structuredClone(solved), target: { ...target, robot: "red" }, winnerId: host.id, winningMoveCount: 1, moveCount: 0, locks: {} };
    room.playReviewStrategy(host.id, [{ robot: mover, direction: move.direction }]);
    room.endMatch(host.id);
    vi.advanceTimersByTime(5_000);
    expect(room.snapshot(host.id).phase).toBe("results");
  });
});
