import { describe, expect, it } from "vitest";
import { findShortestSolutions } from "./solver.js";
import type { BoardDefinition, RobotPositions, Target } from "./types.js";

const board: BoardDefinition = { id: "solver-test", size: 4, blocked: [], walls: [], targets: [] };
const robots: RobotPositions = {
  red: { row: 0, col: 0 }, blue: { row: 0, col: 3 }, green: { row: 3, col: 0 }, yellow: { row: 3, col: 3 }, silver: { row: 2, col: 2 }
};

describe("shortest solution search", () => {
  it("finds a shortest colored-target route within the proof bound", () => {
    const target: Target = { id: "red", position: { row: 0, col: 2 }, robot: "red", symbol: "circle" };
    const result = findShortestSolutions(board, robots, target, 3);
    expect(result.moveCount).toBe(1);
    expect(result.solutions[0]).toEqual([{ robot: "red", direction: "east" }]);
  });

  it("returns multiple equal shortest strategies for wild targets", () => {
    const target: Target = { id: "wild", position: { row: 0, col: 2 }, robot: "wild", symbol: "vortex" };
    const result = findShortestSolutions(board, robots, target, 3, 5);
    expect(result).toMatchObject({ moveCount: 1, capped: false });
    expect(result.solutions).toHaveLength(2);
  });

  it("stops after the configured number of shortest strategies", () => {
    const target: Target = { id: "blue", position: { row: 1, col: 1 }, robot: "blue", symbol: "square" };
    const result = findShortestSolutions(board, robots, target, 6, 5);
    expect(result).toMatchObject({ moveCount: 4, capped: true });
    expect(result.solutions).toHaveLength(5);
  });

  it("reports no route when the maximum depth is below the optimum", () => {
    const target: Target = { id: "red", position: { row: 1, col: 1 }, robot: "red", symbol: "circle" };
    expect(findShortestSolutions(board, robots, target, 1).moveCount).toBeNull();
  });
});
