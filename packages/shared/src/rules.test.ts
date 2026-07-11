import { describe, expect, it } from "vitest";
import { assembleBoard, classicBoard, createRandomBoard, quadrants } from "./board.js";
import { legalMoves, moveRobot, randomRobotPositions, targetSatisfied, validatePlacement } from "./rules.js";
import type { RobotPositions } from "./types.js";

const robots: RobotPositions = {
  red: { row: 0, col: 0 }, blue: { row: 0, col: 5 }, green: { row: 5, col: 0 },
  yellow: { row: 15, col: 15 }, silver: { row: 10, col: 10 }
};

describe("movement", () => {
  it("slides until another robot", () => expect(moveRobot(classicBoard, robots, "red", "east")).toEqual({ row: 0, col: 4 }));
  it("rejects a direction with no travel", () => expect(moveRobot(classicBoard, robots, "red", "north")).toBeNull());
  it("returns only the legal landing cells", () => {
    expect(legalMoves(classicBoard, robots, "red")).toEqual([
      { direction: "east", destination: { row: 0, col: 4 } },
      { direction: "south", destination: { row: 4, col: 0 } }
    ]);
  });
});

describe("placement", () => {
  it("accepts five distinct ordinary cells", () => expect(validatePlacement(classicBoard, robots)).toBeNull());
  it("rejects a destination", () => expect(validatePlacement(classicBoard, { ...robots, red: classicBoard.targets[0]!.position })).toMatch(/destination/));
  it("generates a complete valid deterministic random setup", () => {
    const first = randomRobotPositions(classicBoard, () => 0.25);
    const second = randomRobotPositions(classicBoard, () => 0.25);
    expect(first).toEqual(second);
    expect(validatePlacement(classicBoard, first)).toBeNull();
    expect(new Set(Object.values(first).map(({ row, col }) => `${row},${col}`)).size).toBe(5);
  });
});

describe("board data", () => {
  it("contains 17 unique valid targets and in-bounds walls", () => {
    expect(new Set(classicBoard.targets.map((target) => target.id)).size).toBe(17);
    expect(new Set(classicBoard.targets.map((target) => `${target.position.row},${target.position.col}`)).size).toBe(17);
    for (const wall of classicBoard.walls) {
      expect(wall.row).toBeGreaterThanOrEqual(0); expect(wall.row).toBeLessThan(classicBoard.size);
      expect(wall.col).toBeGreaterThanOrEqual(0); expect(wall.col).toBeLessThan(classicBoard.size);
    }
  });
  it("gives every quadrant the same two center-corner walls", () => {
    for (const quadrant of quadrants) {
      expect(quadrant.walls).toContainEqual({ row: 7, col: 7, side: "north" });
      expect(quadrant.walls).toContainEqual({ row: 7, col: 7, side: "west" });
    }
  });
  it("rotates quadrant coordinates and wall directions into each corner", () => {
    const source = quadrants[0]!;
    const target = source.targets[0]!;
    const repeated = assembleBoard([source, source, source, source]);
    const copies = repeated.targets.filter((candidate) => candidate.id === target.id);
    const { row, col } = target.position;
    expect(copies.map((candidate) => candidate.position)).toEqual([
      { row, col }, { row: col, col: 15 - row }, { row: 15 - row, col: 15 - col }, { row: 15 - col, col: row }
    ]);
    const wall = source.walls[0]!;
    const clockwise = { north: "east", east: "south", south: "west", west: "north" } as const;
    expect(repeated.walls).toContainEqual({ row: wall.col, col: 15 - wall.row, side: clockwise[wall.side] });
  });
  it("creates deterministic complete shuffled boards", () => {
    const unchanged = createRandomBoard(() => 0.99);
    const shuffled = createRandomBoard(() => 0);
    expect(unchanged.id).not.toBe(shuffled.id);
    for (const board of [unchanged, shuffled]) {
      expect(board.targets).toHaveLength(17);
      expect(new Set(board.targets.map((target) => target.id)).size).toBe(17);
    }
  });
  it("guarantees a different arrangement when the previous board is excluded", () => {
    const previous = createRandomBoard(() => 0.99);
    const next = createRandomBoard(() => 0.99, previous.id);
    expect(next.id).not.toBe(previous.id);
    expect(next.targets.map((target) => `${target.id}:${target.position.row},${target.position.col}`))
      .not.toEqual(previous.targets.map((target) => `${target.id}:${target.position.row},${target.position.col}`));
  });
});

describe("targets", () => {
  it("requires a matching colored robot", () => {
    const target = classicBoard.targets.find((candidate) => candidate.robot !== "wild")!;
    if (target.robot === "wild") throw new Error("Expected a colored target");
    const other = (["red", "blue", "green", "yellow"] as const).find((robot) => robot !== target.robot)!;
    const away = target.position.row === 0 && target.position.col === 0 ? { row: 0, col: 1 } : { row: 0, col: 0 };
    expect(targetSatisfied(target, { ...robots, [target.robot]: target.position })).toBe(true);
    expect(targetSatisfied(target, { ...robots, [target.robot]: away, [other]: target.position })).toBe(false);
  });
  it("allows any robot on the wildcard", () => {
    const target = classicBoard.targets.find((item) => item.robot === "wild")!;
    expect(targetSatisfied(target, { ...robots, silver: target.position })).toBe(true);
  });
});
